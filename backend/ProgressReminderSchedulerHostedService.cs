using System.Globalization;
using MySqlConnector;

sealed class ProgressReminderSchedulerHostedService(
    IConfiguration configuration,
    IServiceScopeFactory scopeFactory,
    ILogger<ProgressReminderSchedulerHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SendDueRemindersAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Progress reminder job failed.");
            }

            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task SendDueRemindersAsync(CancellationToken cancellationToken)
    {
        var connectionString = BuildConnectionString(configuration);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return;
        }

        var londonNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, ResolveLondonTimeZone());
        if (londonNow.Hour != 21)
        {
            return;
        }

        await using var connection = new MySqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        await EnsureSchemaAsync(connection, cancellationToken);

        var reminderDate = londonNow.Date;
        await using var command = new MySqlCommand(
            """
            SELECT u.id, u.phone_number
            FROM users u
            WHERE u.phone_number IS NOT NULL
              AND TRIM(u.phone_number) <> ''
              AND NOT EXISTS (
                  SELECT 1
                  FROM daily_entries d
                  WHERE d.user_id = u.id AND d.entry_date = @reminderDate
              );
            """,
            connection);
        command.Parameters.AddWithValue("@reminderDate", reminderDate.Date);

        var recipients = new List<(long UserId, string PhoneNumber)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                recipients.Add((reader.GetInt64("id"), reader.GetString("phone_number")));
            }
        }

        using var scope = scopeFactory.CreateScope();
        var smsService = scope.ServiceProvider.GetRequiredService<LockedInSmsService>();
        foreach (var recipient in recipients)
        {
            if (!await ClaimReminderAsync(connection, recipient.UserId, reminderDate, cancellationToken))
            {
                continue;
            }

            try
            {
                await smsService.SendAsync(
                    recipient.PhoneNumber,
                    "Locked In reminder: take a moment to log your progress for today.",
                    cancellationToken);
                await MarkReminderSentAsync(connection, recipient.UserId, reminderDate, null, true, cancellationToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await MarkReminderSentAsync(connection, recipient.UserId, reminderDate, ex.Message, false, cancellationToken);
                logger.LogError(ex, "Progress reminder failed for user {UserId}.", recipient.UserId);
            }
        }
    }

    private static async Task<bool> ClaimReminderAsync(
        MySqlConnection connection,
        long userId,
        DateTime reminderDate,
        CancellationToken cancellationToken)
    {
        await using var insert = new MySqlCommand(
            """
            INSERT INTO progress_reminder_sms (user_id, reminder_date, status, attempts, created_at, updated_at)
            VALUES (@userId, @reminderDate, 'pending', 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE id = id;
            """,
            connection);
        insert.Parameters.AddWithValue("@userId", userId);
        insert.Parameters.AddWithValue("@reminderDate", reminderDate.Date);
        await insert.ExecuteNonQueryAsync(cancellationToken);

        await using var select = new MySqlCommand(
            """
            SELECT status
            FROM progress_reminder_sms
            WHERE user_id = @userId AND reminder_date = @reminderDate
            LIMIT 1;
            """,
            connection);
        select.Parameters.AddWithValue("@userId", userId);
        select.Parameters.AddWithValue("@reminderDate", reminderDate.Date);
        var status = Convert.ToString(await select.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        return !string.Equals(status, "sent", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task MarkReminderSentAsync(
        MySqlConnection connection,
        long userId,
        DateTime reminderDate,
        string? error,
        bool sent,
        CancellationToken cancellationToken)
    {
        await using var update = new MySqlCommand(
            """
            UPDATE progress_reminder_sms
            SET status = @status,
                attempts = attempts + 1,
                sent_at = CASE WHEN @sent = 1 THEN UTC_TIMESTAMP() ELSE sent_at END,
                last_error = @lastError,
                updated_at = UTC_TIMESTAMP()
            WHERE user_id = @userId AND reminder_date = @reminderDate;
            """,
            connection);
        update.Parameters.AddWithValue("@status", sent ? "sent" : "pending");
        update.Parameters.AddWithValue("@sent", sent);
        update.Parameters.AddWithValue("@lastError", string.IsNullOrWhiteSpace(error) ? DBNull.Value : error);
        update.Parameters.AddWithValue("@userId", userId);
        update.Parameters.AddWithValue("@reminderDate", reminderDate.Date);
        await update.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task EnsureSchemaAsync(MySqlConnection connection, CancellationToken cancellationToken)
    {
        await using var columnCheck = new MySqlCommand(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'users'
              AND column_name = 'phone_number';
            """,
            connection);
        var phoneColumnExists = Convert.ToInt32(await columnCheck.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) > 0;
        if (!phoneColumnExists)
        {
            await using var addColumn = new MySqlCommand(
                "ALTER TABLE users ADD COLUMN phone_number VARCHAR(32) NULL;",
                connection);
            await addColumn.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var table = new MySqlCommand(
            """
            CREATE TABLE IF NOT EXISTS progress_reminder_sms (
                id BIGINT NOT NULL AUTO_INCREMENT,
                user_id BIGINT NOT NULL,
                reminder_date DATE NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                attempts INT NOT NULL DEFAULT 0,
                sent_at DATETIME NULL,
                last_error TEXT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_progress_reminder_sms_user_date (user_id, reminder_date),
                KEY ix_progress_reminder_sms_date (reminder_date)
            );
            """,
            connection);
        await table.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? BuildConnectionString(IConfiguration configuration)
    {
        var direct = configuration["ConnectionStrings:MySql"] ?? configuration["MYSQL_CONNECTION_STRING"];
        if (!string.IsNullOrWhiteSpace(direct))
        {
            return direct;
        }

        var host = configuration["MYSQL_HOST"];
        var port = configuration["MYSQL_PORT"];
        var database = configuration["MYSQL_DATABASE"];
        var username = configuration["MYSQL_USERNAME"];
        var password = configuration["MYSQL_PASSWORD"];
        if (string.IsNullOrWhiteSpace(host) ||
            string.IsNullOrWhiteSpace(port) ||
            string.IsNullOrWhiteSpace(database) ||
            string.IsNullOrWhiteSpace(username) ||
            string.IsNullOrWhiteSpace(password))
        {
            return null;
        }

        return $"Server={host};Port={port};Database={database};User ID={username};Password={password};SslMode={configuration["MYSQL_SSLMODE"] ?? "Preferred"};AllowPublicKeyRetrieval=True;TreatTinyAsBoolean=True;";
    }

    private static TimeZoneInfo ResolveLondonTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("GMT Standard Time");
        }
    }
}
