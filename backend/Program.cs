using System.Globalization;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

var environmentName = builder.Environment.EnvironmentName;
const string environmentFileName = "siteenvironment.donotcommit";
if (File.Exists(environmentFileName))
{
    var fileEnvironment = File.ReadAllText(environmentFileName).Trim();
    if (!string.IsNullOrWhiteSpace(fileEnvironment))
    {
        environmentName = fileEnvironment;
    }
}

builder.Configuration.AddJsonFile($"sensitive.{environmentName}.donotcommit", optional: true, reloadOnChange: true);
builder.Configuration.AddJsonFile("sqlinfo.donotcommit", optional: true, reloadOnChange: true);
builder.Configuration.AddJsonFile("sensitive.live.donotcommit", optional: true, reloadOnChange: true);

var mysqlConnectionString = BuildMySqlConnectionStringSafe(builder.Configuration);
if (mysqlConnectionString is not null)
{
    builder.Configuration["ConnectionStrings:MySql"] = mysqlConnectionString;
}

const string defaultCorsOrigins = "https://lockedin-68fm.onrender.com";
var configuredCorsOrigins = (builder.Configuration["CORS_ORIGINS"] ?? defaultCorsOrigins)
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .Where(origin => !string.IsNullOrWhiteSpace(origin))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddOpenApi();
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        "frontend",
        policy => policy.WithOrigins(configuredCorsOrigins).AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

var metricKeys = new HashSet<string>
{
    "waterLiters",
    "exerciseMinutes",
    "sleepHours",
    "steps",
    "moneySpent",
};
var dbConnectionString = builder.Configuration.GetConnectionString("MySql");

app.MapPost("/api/auth/signup", async (SignupRequest request) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    var username = request.Username.Trim();
    if (string.IsNullOrWhiteSpace(username) || username.Length > 50)
    {
        return Results.BadRequest(new { error = "Username must be between 1 and 50 characters." });
    }

    var existing = await LoadAuthUserByUsernameAsync(dbConnectionString, username);
    if (existing is not null)
    {
        return Results.Conflict(new { error = "Username is already taken." });
    }

    var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.Password);
    var createdUserId = await InsertUserAsync(dbConnectionString, username, passwordHash, request.DisplayName?.Trim());
    var user = await LoadUserByIdAsync(dbConnectionString, createdUserId);

    return user is null
        ? Results.Problem("User was created but could not be loaded.")
        : Results.Ok(user);
});

app.MapPost("/api/auth/login", async (LoginRequest request) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    var username = request.Username.Trim();
    var authUser = await LoadAuthUserByUsernameAsync(dbConnectionString, username);
    if (authUser is null || !BCrypt.Net.BCrypt.Verify(request.Password, authUser.Value.PasswordHash))
    {
        return Results.Unauthorized();
    }

    var user = await LoadUserByIdAsync(dbConnectionString, authUser.Value.Id);
    return user is null ? Results.Unauthorized() : Results.Ok(user);
});

app.MapDelete("/api/users/{userId}", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    try
    {
        await DeleteUserAccountAsync(dbConnectionString, userIdValue);
        return Results.NoContent();
    }
    catch (MySqlException ex)
    {
        return Results.Problem($"Failed to delete account (MySQL {ex.Number}): {ex.Message}");
    }
});

app.MapGet("/api/users", async () =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    var users = await LoadUsersAsync(dbConnectionString);
    return Results.Ok(users);
});

app.MapGet("/api/users/{userId}/goals", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    var goals = await LoadUserGoalsAsync(dbConnectionString, userIdValue);
    return Results.Ok(goals);
});

app.MapGet("/api/users/{userId}/room", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    try
    {
        var roomCode = await LoadUserRoomCodeAsync(dbConnectionString, userIdValue);
        return Results.Ok(new { roomCode });
    }
    catch (MySqlException ex)
    {
        return Results.Problem($"Failed to load room (MySQL {ex.Number}): {ex.Message}");
    }
});

app.MapPut("/api/users/{userId}/room", async (string userId, SaveUserRoomRequest request) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    var normalizedRoomCode = NormalizeRoomCode(request.RoomCode);
    if (string.IsNullOrWhiteSpace(normalizedRoomCode))
    {
        return Results.BadRequest(new { error = "Room code is required." });
    }

    if (!IsValidRoomCode(normalizedRoomCode))
    {
        return Results.BadRequest(new { error = "Room code must be 1-16 letters or numbers." });
    }

    try
    {
        await UpsertUserRoomCodeAsync(dbConnectionString, userIdValue, normalizedRoomCode);
        return Results.Ok(new { roomCode = normalizedRoomCode });
    }
    catch (MySqlException ex)
    {
        return Results.Problem($"Failed to save room code (MySQL {ex.Number}): {ex.Message}");
    }
});

app.MapDelete("/api/users/{userId}/room", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    try
    {
        await RemoveUserRoomCodeAsync(dbConnectionString, userIdValue);
        return Results.NoContent();
    }
    catch (MySqlException ex)
    {
        return Results.Problem($"Failed to remove room code (MySQL {ex.Number}): {ex.Message}");
    }
});

async Task<IResult> SaveUserGoalsAsync(string userId, SaveUserGoalsRequest request)
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    if (!request.IsValid())
    {
        return Results.BadRequest(new { error = "Goals must be positive values." });
    }

    try
    {
        await UpsertUserGoalsAsync(dbConnectionString, userIdValue, request);
        var goals = await LoadUserGoalsAsync(dbConnectionString, userIdValue);
        return Results.Ok(goals);
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        return Results.Problem("user_goals table does not exist.");
    }
    catch (MySqlException ex)
    {
        return Results.Problem($"Failed to save goals (MySQL {ex.Number}): {ex.Message}");
    }
}

app.MapPost("/api/users/{userId}/goals", SaveUserGoalsAsync);
app.MapPut("/api/users/{userId}/goals", SaveUserGoalsAsync);

app.MapGet("/api/debug/db-status", async () =>
{
    var sensitiveLivePath = Path.Combine(app.Environment.ContentRootPath, "sensitive.live.donotcommit");

    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Ok(new
        {
            environmentName,
            aspNetCoreEnvironment = app.Environment.EnvironmentName,
            contentRootPath = app.Environment.ContentRootPath,
            sensitiveLiveFileExists = File.Exists(sensitiveLivePath),
            hasConnectionString = false,
            canConnect = false,
            usersTableExists = false,
            dailyEntriesTableExists = false,
        });
    }

    try
    {
        var usersTableExists = await TableExistsAsync(dbConnectionString, "users");
        var dailyEntriesTableExists = await TableExistsAsync(dbConnectionString, "daily_entries");
        var userGoalsTableExists = await TableExistsAsync(dbConnectionString, "user_goals");
        var usersColumns = await LoadColumnNamesAsync(dbConnectionString, "users");
        var dailyEntriesColumns = await LoadColumnNamesAsync(dbConnectionString, "daily_entries");
        var userGoalsColumns = await LoadColumnNamesAsync(dbConnectionString, "user_goals");

        return Results.Ok(new
        {
            environmentName,
            aspNetCoreEnvironment = app.Environment.EnvironmentName,
            contentRootPath = app.Environment.ContentRootPath,
            sensitiveLiveFileExists = File.Exists(sensitiveLivePath),
            hasConnectionString = true,
            canConnect = true,
            usersTableExists,
            dailyEntriesTableExists,
            userGoalsTableExists,
            usersColumns,
            dailyEntriesColumns,
            userGoalsColumns,
        });
    }
    catch (Exception ex)
    {
        return Results.Ok(new
        {
            environmentName,
            aspNetCoreEnvironment = app.Environment.EnvironmentName,
            contentRootPath = app.Environment.ContentRootPath,
            sensitiveLiveFileExists = File.Exists(sensitiveLivePath),
            hasConnectionString = true,
            canConnect = false,
            errorType = ex.GetType().Name,
            errorMessage = ex.Message,
            usersTableExists = false,
            dailyEntriesTableExists = false,
            userGoalsTableExists = false,
            usersColumns = Array.Empty<string>(),
            dailyEntriesColumns = Array.Empty<string>(),
            userGoalsColumns = Array.Empty<string>(),
        });
    }
});

app.MapGet("/api/today/{userId}", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.NotFound();
    }

    var today = DateOnly.FromDateTime(DateTime.Today);
    var entry = await LoadEntryForDayAsync(dbConnectionString, userIdValue, today);
    return Results.Ok(entry);
});

app.MapPost("/api/entries", async (SaveEntryRequest request) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(request.UserId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.BadRequest(new { error = "Unknown userId." });
    }

    if (!DateOnly.TryParseExact(request.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
    {
        return Results.BadRequest(new { error = "Date must be in yyyy-MM-dd format." });
    }

    if (request.WaterLiters < 0 || request.ExerciseMinutes < 0 || request.SleepHours < 0 || request.Steps < 0 || request.MoneySpent < 0)
    {
        return Results.BadRequest(new { error = "Metrics cannot be negative." });
    }

    await UpsertEntryAsync(dbConnectionString, userIdValue, date, request);
    return Results.NoContent();
});

app.MapPost("/api/live-entries", async (SaveEntryRequest request) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(request.UserId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, userIdValue))
    {
        return Results.BadRequest(new { error = "Unknown userId." });
    }

    if (!DateOnly.TryParseExact(request.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
    {
        return Results.BadRequest(new { error = "Date must be in yyyy-MM-dd format." });
    }

    if (request.WaterLiters < 0 || request.ExerciseMinutes < 0 || request.SleepHours < 0 || request.Steps < 0 || request.MoneySpent < 0)
    {
        return Results.BadRequest(new { error = "Metrics cannot be negative." });
    }

    await UpsertLiveEntryAsync(dbConnectionString, userIdValue, date, request);
    return Results.NoContent();
});

app.MapGet("/api/dashboard/{userId}", async (string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    if (!long.TryParse(userId, out var userIdValue))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    var users = await LoadUsersAsync(dbConnectionString);
    var user = users.FirstOrDefault(item => item.Id == userIdValue.ToString(CultureInfo.InvariantCulture));
    if (user is null)
    {
        return Results.NotFound();
    }

    var userEntries = await LoadEntriesForUserAsync(dbConnectionString, userIdValue);
    var weeklyTrend = BuildWeeklyTrend(userEntries);
    var monthlyTrend = BuildMonthlyTrend(userEntries);
    var summary = await BuildDashboardSummaryAsync(dbConnectionString, userIdValue, userEntries, user.StreakDays);
    var bestRecords = BuildBestRecords(userEntries);

    return Results.Ok(
        new
        {
            weeklyTrend,
            monthlyTrend,
            summary,
            bestRecords,
        });
});

app.MapGet("/api/compare", async (string metric, string? range, string userId) =>
{
    if (string.IsNullOrWhiteSpace(dbConnectionString))
    {
        return Results.Problem("Database connection is not configured.");
    }

    var metricKey = metric.Trim();
    if (!metricKeys.Contains(metricKey))
    {
        return Results.BadRequest(new { error = "Unsupported metric." });
    }

    if (!long.TryParse(userId, out var requesterUserId))
    {
        return Results.BadRequest(new { error = "Invalid userId." });
    }

    if (!await UserExistsAsync(dbConnectionString, requesterUserId))
    {
        return Results.NotFound();
    }

    var users = await LoadUsersForCompareAsync(dbConnectionString, requesterUserId);
    var entries = await LoadEntriesForUsersAsync(dbConnectionString, users);
    var effectiveRange = string.Equals(range, "monthly", StringComparison.OrdinalIgnoreCase)
        ? "monthly"
        : string.Equals(range, "today", StringComparison.OrdinalIgnoreCase)
            ? "today"
            : "weekly";

    var compareRows = effectiveRange switch
    {
        "monthly" => BuildMonthlyCompare(users, entries, metricKey),
        "today" => await BuildTodayCompareAsync(dbConnectionString, users, metricKey),
        _ => BuildWeeklyCompare(users, entries, metricKey),
    };

    return Results.Ok(new { metric = metricKey, data = compareRows });
});

app.Run();

static string? BuildMySqlConnectionStringSafe(IConfiguration configuration)
{
    var directConnectionString = configuration["ConnectionStrings:MySql"] ?? configuration["MYSQL_CONNECTION_STRING"];
    if (!string.IsNullOrWhiteSpace(directConnectionString))
    {
        return directConnectionString;
    }

    var mysqlHost = configuration["MYSQL_HOST"];
    var mysqlPort = configuration["MYSQL_PORT"];
    var mysqlDatabase = configuration["MYSQL_DATABASE"];
    var mysqlUsername = configuration["MYSQL_USERNAME"];
    var mysqlPassword = configuration["MYSQL_PASSWORD"];
    var mysqlSslMode = configuration["MYSQL_SSLMODE"] ?? "Preferred";

    if (string.IsNullOrWhiteSpace(mysqlHost) ||
        string.IsNullOrWhiteSpace(mysqlPort) ||
        string.IsNullOrWhiteSpace(mysqlDatabase) ||
        string.IsNullOrWhiteSpace(mysqlUsername) ||
        string.IsNullOrWhiteSpace(mysqlPassword))
    {
        return null;
    }

    return $"Server={mysqlHost};Port={mysqlPort};Database={mysqlDatabase};User ID={mysqlUsername};Password={mysqlPassword};SslMode={mysqlSslMode};AllowPublicKeyRetrieval=True;TreatTinyAsBoolean=True;";
}

static string? BuildMySqlConnectionString(IConfiguration configuration)
{
    var directConnectionString = configuration["ConnectionStrings:MySql"] ?? configuration["MYSQL_CONNECTION_STRING"];
    if (!string.IsNullOrWhiteSpace(directConnectionString))
    {
        return directConnectionString;
    }

    var mysqlHost = configuration["MYSQL_HOST"];
    var mysqlPort = configuration["MYSQL_PORT"];
    var mysqlDatabase = configuration["MYSQL_DATABASE"];
    var mysqlUsername = configuration["MYSQL_USERNAME"];
    var mysqlPassword = configuration["MYSQL_PASSWORD"];
    var mysqlSslMode = configuration["MYSQL_SSLMODE"] ?? "Preferred";

    if (string.IsNullOrWhiteSpace(mysqlHost) ||
        string.IsNullOrWhiteSpace(mysqlPort) ||
        string.IsNullOrWhiteSpace(mysqlDatabase) ||
        string.IsNullOrWhiteSpace(mysqlUsername) ||
        string.IsNullOrWhiteSpace(mysqlPassword))
    {
        return null;
    }

    return $"Server={mysqlHost};Port={mysqlPort};Database={mysqlDatabase};User ID={mysqlUsername};Password={mysqlPassword};SslMode={mysqlSslMode};AllowPublicKeyRetrieval=True;TreatTinyAsBoolean=True;";
}

static async Task<List<AppUser>> LoadUsersAsync(string connectionString)
{
    var users = new List<(long Id, string Username)>();
    await using (var connection = new MySqlConnection(connectionString))
    {
        await connection.OpenAsync();
        await using var command = new MySqlCommand(
            """
            SELECT id, username
            FROM users
            ORDER BY id;
            """,
            connection);

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            users.Add((reader.GetInt64("id"), reader.GetString("username")));
        }

    }

    var datesByUserId = await LoadDatesByUserIdAsync(connectionString);

    return users
        .Select(user =>
        {
            datesByUserId.TryGetValue(user.Id, out var dates);
            return new AppUser(
                user.Id.ToString(CultureInfo.InvariantCulture),
                user.Username,
                CalculateCurrentStreak(dates ?? []),
                DateOnly.FromDateTime(DateTime.Today).ToString("yyyy-MM-dd"));
        })
        .ToList();
}

static async Task<List<AppUser>> LoadUsersForCompareAsync(string connectionString, long requesterUserId)
{
    var allUsers = await LoadUsersAsync(connectionString);
    var requesterId = requesterUserId.ToString(CultureInfo.InvariantCulture);
    var requesterRoomCode = await LoadUserRoomCodeAsync(connectionString, requesterUserId);
    if (string.IsNullOrWhiteSpace(requesterRoomCode))
    {
        return allUsers.Where(user => user.Id == requesterId).ToList();
    }

    var roomUserIds = await LoadUserIdsByRoomCodeAsync(connectionString, requesterRoomCode);
    roomUserIds.Add(requesterUserId);

    return allUsers
        .Where(user => long.TryParse(user.Id, out var id) && roomUserIds.Contains(id))
        .ToList();
}

static async Task<HashSet<long>> LoadUserIdsByRoomCodeAsync(string connectionString, string roomCode)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureRoomTablesAsync(connection);

    try
    {
        await using var command = new MySqlCommand(
            """
            SELECT user_id
            FROM user_rooms
            WHERE room_code = @roomCode;
            """,
            connection);
        command.Parameters.AddWithValue("@roomCode", roomCode);

        var userIds = new HashSet<long>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            userIds.Add(reader.GetInt64("user_id"));
        }

        return userIds;
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var fallbackCommand = new MySqlCommand(
            """
            SELECT user_id
            FROM user_rooms
            WHERE code = @roomCode;
            """,
            connection);
        fallbackCommand.Parameters.AddWithValue("@roomCode", roomCode);

        var fallbackUserIds = new HashSet<long>();
        await using var fallbackReader = await fallbackCommand.ExecuteReaderAsync();
        while (await fallbackReader.ReadAsync())
        {
            fallbackUserIds.Add(fallbackReader.GetInt64("user_id"));
        }

        return fallbackUserIds;
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        return new HashSet<long>();
    }
}

static async Task<Dictionary<long, HashSet<DateOnly>>> LoadDatesByUserIdAsync(string connectionString)
{
    var datesByUserId = new Dictionary<long, HashSet<DateOnly>>();

    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date
        FROM daily_entries;
        """,
        connection);

    try
    {
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var userId = reader.GetInt64("user_id");
            var date = DateOnly.FromDateTime(reader.GetDateTime("entry_date"));

            if (!datesByUserId.TryGetValue(userId, out var dates))
            {
                dates = new HashSet<DateOnly>();
                datesByUserId[userId] = dates;
            }

            dates.Add(date);
        }
    }
    catch (MySqlException ex) when (ex.Number == 1146 || ex.Number == 1054)
    {
        return new Dictionary<long, HashSet<DateOnly>>();
    }

    return datesByUserId;
}

static async Task<bool> TableExistsAsync(string connectionString, string tableName)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new MySqlCommand(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = @tableName;
        """,
        connection);
    command.Parameters.AddWithValue("@tableName", tableName);
    var count = Convert.ToInt32(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    return count > 0;
}

static async Task<List<string>> LoadColumnNamesAsync(string connectionString, string tableName)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new MySqlCommand(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = @tableName
        ORDER BY ordinal_position;
        """,
        connection);
    command.Parameters.AddWithValue("@tableName", tableName);

    var names = new List<string>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        names.Add(reader.GetString("column_name"));
    }

    return names;
}

static async Task<(long Id, string Username, string? DisplayName, string PasswordHash)?> LoadAuthUserByUsernameAsync(
    string connectionString,
    string username)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    try
    {
        await using var command = new MySqlCommand(
            """
            SELECT id, username, password_hash
            FROM users
            WHERE username = @username
            LIMIT 1;
            """,
            connection);
        command.Parameters.AddWithValue("@username", username);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return (
            reader.GetInt64("id"),
            reader.GetString("username"),
            null,
            reader.GetString("password_hash"));
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var fallbackCommand = new MySqlCommand(
            """
            SELECT id, username, password
            FROM users
            WHERE username = @username
            LIMIT 1;
            """,
            connection);
        fallbackCommand.Parameters.AddWithValue("@username", username);

        await using var fallbackReader = await fallbackCommand.ExecuteReaderAsync();
        if (!await fallbackReader.ReadAsync())
        {
            return null;
        }

        return (
            fallbackReader.GetInt64("id"),
            fallbackReader.GetString("username"),
            null,
            fallbackReader.GetString("password"));
    }
}

static async Task<long> InsertUserAsync(string connectionString, string username, string passwordHash, string? displayName)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    try
    {
        await using var command = new MySqlCommand(
            """
            INSERT INTO users (username, password_hash, display_name)
            VALUES (@username, @passwordHash, @displayName);
            """,
            connection);
        command.Parameters.AddWithValue("@username", username);
        command.Parameters.AddWithValue("@passwordHash", passwordHash);
        command.Parameters.AddWithValue("@displayName", string.IsNullOrWhiteSpace(displayName) ? DBNull.Value : displayName);
        await command.ExecuteNonQueryAsync();

        return command.LastInsertedId;
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var fallbackCommand = new MySqlCommand(
            """
            INSERT INTO users (username, password)
            VALUES (@username, @passwordHash);
            """,
            connection);
        fallbackCommand.Parameters.AddWithValue("@username", username);
        fallbackCommand.Parameters.AddWithValue("@passwordHash", passwordHash);
        await fallbackCommand.ExecuteNonQueryAsync();

        return fallbackCommand.LastInsertedId;
    }
}

static async Task<AppUser?> LoadUserByIdAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new MySqlCommand(
        """
        SELECT id, username
        FROM users
        WHERE id = @userId
        LIMIT 1;
        """,
        connection);
    command.Parameters.AddWithValue("@userId", userId);

    await using var reader = await command.ExecuteReaderAsync();
    if (!await reader.ReadAsync())
    {
        return null;
    }

    var username = reader.GetString("username");
    await reader.CloseAsync();

    var entries = await LoadEntriesForUserAsync(connectionString, userId);
    var userDays = entries.Select(item => item.Date).Distinct().ToHashSet();
    return new AppUser(
        userId.ToString(CultureInfo.InvariantCulture),
        username,
        CalculateCurrentStreak(userDays),
        DateOnly.FromDateTime(DateTime.Today).ToString("yyyy-MM-dd"));
}

static async Task<bool> UserExistsAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await using var command = new MySqlCommand("SELECT 1 FROM users WHERE id = @userId LIMIT 1;", connection);
    command.Parameters.AddWithValue("@userId", userId);
    var result = await command.ExecuteScalarAsync();
    return result is not null;
}

static async Task<UserGoals?> LoadUserGoalsAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    try
    {
        await using var command = new MySqlCommand(
            """
            SELECT metric, target_value
            FROM user_goals
            WHERE user_id = @userId AND (active_to IS NULL OR active_to >= CURRENT_DATE())
            ORDER BY updated_at DESC, id DESC;
            """,
            connection);
        command.Parameters.AddWithValue("@userId", userId);

        await using var reader = await command.ExecuteReaderAsync();
        decimal? waterLiters = null;
        int? exerciseMinutes = null;
        decimal? sleepHours = null;
        int? steps = null;
        decimal? moneySpent = null;

        while (await reader.ReadAsync())
        {
            var metric = reader.GetString("metric");
            var target = reader.GetDecimal("target_value");
            var normalizedMetric = metric.Trim().ToLowerInvariant();

            if ((normalizedMetric == "waterliters" || normalizedMetric == "water_liters" || normalizedMetric == "water") && waterLiters is null)
            {
                waterLiters = target;
                continue;
            }

            if ((normalizedMetric == "exerciseminutes" || normalizedMetric == "exercise_minutes" || normalizedMetric == "exercise") && exerciseMinutes is null)
            {
                exerciseMinutes = (int)Math.Round(target, MidpointRounding.AwayFromZero);
                continue;
            }

            if ((normalizedMetric == "sleephours" || normalizedMetric == "sleep_hours" || normalizedMetric == "sleep") && sleepHours is null)
            {
                sleepHours = target;
                continue;
            }

            if (normalizedMetric == "steps" && steps is null)
            {
                steps = (int)Math.Round(target, MidpointRounding.AwayFromZero);
                continue;
            }

            if ((normalizedMetric == "moneyspent" || normalizedMetric == "money_spent" || normalizedMetric == "money") && moneySpent is null)
            {
                moneySpent = target;
            }
        }

        if (waterLiters is not null &&
            exerciseMinutes is not null &&
            sleepHours is not null &&
            steps is not null &&
            moneySpent is not null)
        {
            return new UserGoals(
                waterLiters.Value,
                exerciseMinutes.Value,
                sleepHours.Value,
                steps.Value,
                moneySpent.Value);
        }

        return null;
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var legacyCommand = new MySqlCommand(
            """
            SELECT water_liters, exercise_minutes, sleep_hours, steps, money_spent
            FROM user_goals
            WHERE user_id = @userId
            LIMIT 1;
            """,
            connection);
        legacyCommand.Parameters.AddWithValue("@userId", userId);

        await using var legacyReader = await legacyCommand.ExecuteReaderAsync();
        if (!await legacyReader.ReadAsync())
        {
            return null;
        }

        return new UserGoals(
            legacyReader.GetDecimal("water_liters"),
            legacyReader.GetInt32("exercise_minutes"),
            legacyReader.GetDecimal("sleep_hours"),
            legacyReader.GetInt32("steps"),
            legacyReader.GetDecimal("money_spent"));
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        return null;
    }
}

static async Task UpsertUserGoalsAsync(string connectionString, long userId, SaveUserGoalsRequest request)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    try
    {
        var metricSets = new[]
        {
            new GoalMetricNames("waterLiters", "exerciseMinutes", "sleepHours", "steps", "moneySpent"),
            new GoalMetricNames("water_liters", "exercise_minutes", "sleep_hours", "steps", "money_spent"),
            new GoalMetricNames("water", "exercise", "sleep", "steps", "money"),
        };

        MySqlException? lastMetricException = null;
        foreach (var metrics in metricSets)
        {
            try
            {
                await UpsertUserGoalsWithMetricsAsync(connection, userId, request, metrics);
                return;
            }
            catch (MySqlException ex) when (ex.Number == 1265 || ex.Number == 1406 || ex.Number == 1366)
            {
                lastMetricException = ex;
            }
        }

        if (lastMetricException is not null)
        {
            throw lastMetricException;
        }
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        try
        {
            await using var legacyCommandWithTimestamps = new MySqlCommand(
                """
                INSERT INTO user_goals (user_id, water_liters, exercise_minutes, sleep_hours, steps, money_spent, created_at, updated_at)
                VALUES (@userId, @waterLiters, @exerciseMinutes, @sleepHours, @steps, @moneySpent, UTC_TIMESTAMP(), UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE
                    water_liters = VALUES(water_liters),
                    exercise_minutes = VALUES(exercise_minutes),
                    sleep_hours = VALUES(sleep_hours),
                    steps = VALUES(steps),
                    money_spent = VALUES(money_spent),
                    updated_at = UTC_TIMESTAMP();
                """,
                connection);

            legacyCommandWithTimestamps.Parameters.AddWithValue("@userId", userId);
            legacyCommandWithTimestamps.Parameters.AddWithValue("@waterLiters", request.WaterLiters);
            legacyCommandWithTimestamps.Parameters.AddWithValue("@exerciseMinutes", request.ExerciseMinutes);
            legacyCommandWithTimestamps.Parameters.AddWithValue("@sleepHours", request.SleepHours);
            legacyCommandWithTimestamps.Parameters.AddWithValue("@steps", request.Steps);
            legacyCommandWithTimestamps.Parameters.AddWithValue("@moneySpent", request.MoneySpent);
            await legacyCommandWithTimestamps.ExecuteNonQueryAsync();
        }
        catch (MySqlException legacyEx) when (legacyEx.Number == 1054)
        {
            await using var legacyCommand = new MySqlCommand(
                """
                INSERT INTO user_goals (user_id, water_liters, exercise_minutes, sleep_hours, steps, money_spent)
                VALUES (@userId, @waterLiters, @exerciseMinutes, @sleepHours, @steps, @moneySpent)
                ON DUPLICATE KEY UPDATE
                    water_liters = VALUES(water_liters),
                    exercise_minutes = VALUES(exercise_minutes),
                    sleep_hours = VALUES(sleep_hours),
                    steps = VALUES(steps),
                    money_spent = VALUES(money_spent);
                """,
                connection);

            legacyCommand.Parameters.AddWithValue("@userId", userId);
            legacyCommand.Parameters.AddWithValue("@waterLiters", request.WaterLiters);
            legacyCommand.Parameters.AddWithValue("@exerciseMinutes", request.ExerciseMinutes);
            legacyCommand.Parameters.AddWithValue("@sleepHours", request.SleepHours);
            legacyCommand.Parameters.AddWithValue("@steps", request.Steps);
            legacyCommand.Parameters.AddWithValue("@moneySpent", request.MoneySpent);
            await legacyCommand.ExecuteNonQueryAsync();
        }
    }

    static async Task UpsertUserGoalsWithMetricsAsync(
        MySqlConnection connection,
        long userId,
        SaveUserGoalsRequest request,
        GoalMetricNames metrics)
    {
        await using var transaction = await connection.BeginTransactionAsync();

        await using (var deactivateCommand = new MySqlCommand(
            """
            UPDATE user_goals
            SET active_to = CURRENT_DATE(), updated_at = UTC_TIMESTAMP()
            WHERE user_id = @userId AND (active_to IS NULL OR active_to >= CURRENT_DATE());
            """,
            connection,
            transaction))
        {
            deactivateCommand.Parameters.AddWithValue("@userId", userId);
            await deactivateCommand.ExecuteNonQueryAsync();
        }

        await using (var insertCommand = new MySqlCommand(
            """
            INSERT INTO user_goals (user_id, metric, target_value, is_lower_better, active_from, active_to, created_at, updated_at)
            VALUES
                (@userId, @waterMetric, @waterLiters, FALSE, CURRENT_DATE(), '9999-12-31', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
                (@userId, @exerciseMetric, @exerciseMinutes, FALSE, CURRENT_DATE(), '9999-12-31', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
                (@userId, @sleepMetric, @sleepHours, FALSE, CURRENT_DATE(), '9999-12-31', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
                (@userId, @stepsMetric, @steps, FALSE, CURRENT_DATE(), '9999-12-31', UTC_TIMESTAMP(), UTC_TIMESTAMP()),
                (@userId, @moneyMetric, @moneySpent, TRUE, CURRENT_DATE(), '9999-12-31', UTC_TIMESTAMP(), UTC_TIMESTAMP());
            """,
            connection,
            transaction))
        {
            insertCommand.Parameters.AddWithValue("@userId", userId);
            insertCommand.Parameters.AddWithValue("@waterMetric", metrics.Water);
            insertCommand.Parameters.AddWithValue("@exerciseMetric", metrics.Exercise);
            insertCommand.Parameters.AddWithValue("@sleepMetric", metrics.Sleep);
            insertCommand.Parameters.AddWithValue("@stepsMetric", metrics.Steps);
            insertCommand.Parameters.AddWithValue("@moneyMetric", metrics.Money);
            insertCommand.Parameters.AddWithValue("@waterLiters", request.WaterLiters);
            insertCommand.Parameters.AddWithValue("@exerciseMinutes", request.ExerciseMinutes);
            insertCommand.Parameters.AddWithValue("@sleepHours", request.SleepHours);
            insertCommand.Parameters.AddWithValue("@steps", request.Steps);
            insertCommand.Parameters.AddWithValue("@moneySpent", request.MoneySpent);
            await insertCommand.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }
}

static async Task<List<DailyEntry>> LoadEntriesForUserAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent
        FROM daily_entries
        WHERE user_id = @userId;
        """,
        connection);
    command.Parameters.AddWithValue("@userId", userId);

    return await ReadEntriesAsync(command);
}

static async Task<List<DailyEntry>> LoadEntriesForUsersAsync(string connectionString, List<AppUser> users)
{
    var userIds = users
        .Select(user => long.TryParse(user.Id, out var id) ? id : 0)
        .Where(id => id > 0)
        .ToHashSet();

    if (userIds.Count == 0)
    {
        return [];
    }

    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent
        FROM daily_entries;
        """,
        connection);

    var entries = await ReadEntriesAsync(command);
    return entries.Where(entry => userIds.Contains(long.Parse(entry.UserId, CultureInfo.InvariantCulture))).ToList();
}

static async Task<DailyEntry?> LoadEntryForDayAsync(string connectionString, long userId, DateOnly date)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent
        FROM daily_entries
        WHERE user_id = @userId AND entry_date = @entryDate
        LIMIT 1;
        """,
        connection);
    command.Parameters.AddWithValue("@userId", userId);
    command.Parameters.AddWithValue("@entryDate", date.ToDateTime(TimeOnly.MinValue));

    var entries = await ReadEntriesAsync(command);
    return entries.FirstOrDefault();
}

static async Task UpsertEntryAsync(string connectionString, long userId, DateOnly date, SaveEntryRequest request)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        INSERT INTO daily_entries (user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent)
        VALUES (@userId, @entryDate, @waterLiters, @exerciseMinutes, @sleepHours, @steps, @moneySpent)
        ON DUPLICATE KEY UPDATE
            water_liters = VALUES(water_liters),
            exercise_minutes = VALUES(exercise_minutes),
            sleep_hours = VALUES(sleep_hours),
            steps = VALUES(steps),
            money_spent = VALUES(money_spent);
        """,
        connection);

    command.Parameters.AddWithValue("@userId", userId);
    command.Parameters.AddWithValue("@entryDate", date.ToDateTime(TimeOnly.MinValue));
    command.Parameters.AddWithValue("@waterLiters", request.WaterLiters);
    command.Parameters.AddWithValue("@exerciseMinutes", request.ExerciseMinutes);
    command.Parameters.AddWithValue("@sleepHours", request.SleepHours);
    command.Parameters.AddWithValue("@steps", request.Steps);
    command.Parameters.AddWithValue("@moneySpent", request.MoneySpent);
    await command.ExecuteNonQueryAsync();
}

static async Task UpsertLiveEntryAsync(string connectionString, long userId, DateOnly date, SaveEntryRequest request)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureLiveEntriesTableAsync(connection);

    await using var command = new MySqlCommand(
        """
        INSERT INTO live_entries (user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent, updated_at)
        VALUES (@userId, @entryDate, @waterLiters, @exerciseMinutes, @sleepHours, @steps, @moneySpent, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE
            water_liters = VALUES(water_liters),
            exercise_minutes = VALUES(exercise_minutes),
            sleep_hours = VALUES(sleep_hours),
            steps = VALUES(steps),
            money_spent = VALUES(money_spent),
            updated_at = UTC_TIMESTAMP();
        """,
        connection);

    command.Parameters.AddWithValue("@userId", userId);
    command.Parameters.AddWithValue("@entryDate", date.ToDateTime(TimeOnly.MinValue));
    command.Parameters.AddWithValue("@waterLiters", request.WaterLiters);
    command.Parameters.AddWithValue("@exerciseMinutes", request.ExerciseMinutes);
    command.Parameters.AddWithValue("@sleepHours", request.SleepHours);
    command.Parameters.AddWithValue("@steps", request.Steps);
    command.Parameters.AddWithValue("@moneySpent", request.MoneySpent);
    await command.ExecuteNonQueryAsync();
}

static async Task<string?> LoadUserRoomCodeAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureRoomTablesAsync(connection);

    try
    {
        await using var command = new MySqlCommand(
            """
            SELECT room_code
            FROM user_rooms
            WHERE user_id = @userId
            LIMIT 1;
            """,
            connection);
        command.Parameters.AddWithValue("@userId", userId);
        var result = await command.ExecuteScalarAsync();
        return result?.ToString();
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var fallbackCommand = new MySqlCommand(
            """
            SELECT code
            FROM user_rooms
            WHERE user_id = @userId
            LIMIT 1;
            """,
            connection);
        fallbackCommand.Parameters.AddWithValue("@userId", userId);
        var fallbackResult = await fallbackCommand.ExecuteScalarAsync();
        return fallbackResult?.ToString();
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        return null;
    }
}

static async Task UpsertUserRoomCodeAsync(string connectionString, long userId, string roomCode)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureRoomTablesAsync(connection);

    try
    {
        await using var upsertUserRoomCommand = new MySqlCommand(
            """
            INSERT INTO user_rooms (user_id, room_code, updated_at)
            VALUES (@userId, @roomCode, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                room_code = VALUES(room_code),
                updated_at = UTC_TIMESTAMP();
            """,
            connection);
        upsertUserRoomCommand.Parameters.AddWithValue("@userId", userId);
        upsertUserRoomCommand.Parameters.AddWithValue("@roomCode", roomCode);
        await upsertUserRoomCommand.ExecuteNonQueryAsync();
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        await using var fallbackUpsertUserRoomCommand = new MySqlCommand(
            """
            INSERT INTO user_rooms (user_id, code, updated_at)
            VALUES (@userId, @roomCode, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                code = VALUES(code),
                updated_at = UTC_TIMESTAMP();
            """,
            connection);
        fallbackUpsertUserRoomCommand.Parameters.AddWithValue("@userId", userId);
        fallbackUpsertUserRoomCommand.Parameters.AddWithValue("@roomCode", roomCode);
        await fallbackUpsertUserRoomCommand.ExecuteNonQueryAsync();
    }
}

static async Task RemoveUserRoomCodeAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureRoomTablesAsync(connection);

    try
    {
        await using var command = new MySqlCommand(
            """
            DELETE FROM user_rooms
            WHERE user_id = @userId;
            """,
            connection);
        command.Parameters.AddWithValue("@userId", userId);
        await command.ExecuteNonQueryAsync();
    }
    catch (MySqlException ex) when (ex.Number == 1054)
    {
        // If schema differs, treat as no-op rather than hard failure.
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        // Table missing means user is effectively not in a room.
    }
}

static async Task DeleteUserAccountAsync(string connectionString, long userId)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();
    await EnsureRoomTablesAsync(connection);
    await using var transaction = await connection.BeginTransactionAsync();

    await DeleteUserDataIfTableExistsAsync(connection, transaction, "daily_entries", userId);
    await DeleteUserDataIfTableExistsAsync(connection, transaction, "user_goals", userId);
    await DeleteUserDataIfTableExistsAsync(connection, transaction, "user_rooms", userId);

    await using (var deleteUserCommand = new MySqlCommand(
        """
        DELETE FROM users
        WHERE id = @userId;
        """,
        connection,
        transaction))
    {
        deleteUserCommand.Parameters.AddWithValue("@userId", userId);
        await deleteUserCommand.ExecuteNonQueryAsync();
    }

    await transaction.CommitAsync();
}

static async Task DeleteUserDataIfTableExistsAsync(MySqlConnection connection, MySqlTransaction transaction, string tableName, long userId)
{
    try
    {
        await using var command = new MySqlCommand(
            $"DELETE FROM `{tableName}` WHERE user_id = @userId;",
            connection,
            transaction);
        command.Parameters.AddWithValue("@userId", userId);
        await command.ExecuteNonQueryAsync();
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        // Ignore missing optional tables in older deployments.
    }
}

static async Task EnsureRoomTablesAsync(MySqlConnection connection)
{
    await using var createUserRoomsTableCommand = new MySqlCommand(
        """
        CREATE TABLE IF NOT EXISTS user_rooms (
            user_id BIGINT NOT NULL,
            room_code VARCHAR(16) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id),
            KEY ix_user_rooms_room_code (room_code)
        );
        """,
        connection);
    await createUserRoomsTableCommand.ExecuteNonQueryAsync();
}

static string NormalizeRoomCode(string? roomCode)
{
    return (roomCode ?? string.Empty).Trim().ToUpperInvariant();
}

static bool IsValidRoomCode(string roomCode)
{
    if (roomCode.Length is < 1 or > 16)
    {
        return false;
    }

    return roomCode.All(char.IsLetterOrDigit);
}

static async Task EnsureLiveEntriesTableAsync(MySqlConnection connection)
{
    await using var command = new MySqlCommand(
        """
        CREATE TABLE IF NOT EXISTS live_entries (
            user_id BIGINT NOT NULL,
            entry_date DATE NOT NULL,
            water_liters DECIMAL(10,2) NOT NULL DEFAULT 0,
            exercise_minutes INT NOT NULL DEFAULT 0,
            sleep_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
            steps INT NOT NULL DEFAULT 0,
            money_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, entry_date)
        );
        """,
        connection);
    await command.ExecuteNonQueryAsync();
}

static async Task<List<DailyEntry>> ReadEntriesAsync(MySqlCommand command)
{
    var results = new List<DailyEntry>();
    await using var reader = await command.ExecuteReaderAsync();
    while (await reader.ReadAsync())
    {
        results.Add(
            new DailyEntry(
                reader.GetInt64("user_id").ToString(CultureInfo.InvariantCulture),
                DateOnly.FromDateTime(reader.GetDateTime("entry_date")),
                reader.GetDecimal("water_liters"),
                reader.GetInt32("exercise_minutes"),
                reader.GetDecimal("sleep_hours"),
                reader.GetInt32("steps"),
                reader.GetDecimal("money_spent")));
    }

    return results;
}

static int CalculateCurrentStreak(IReadOnlyCollection<DateOnly> userDays)
{
    if (userDays.Count == 0)
    {
        return 0;
    }

    var days = userDays.OrderByDescending(item => item).ToList();
    var streak = 0;
    var expected = DateOnly.FromDateTime(DateTime.Today);

    foreach (var day in days)
    {
        if (day == expected)
        {
            streak++;
            expected = expected.AddDays(-1);
            continue;
        }

        if (day > expected)
        {
            continue;
        }

        break;
    }

    return streak;
}

static List<object> BuildWeeklyTrend(List<DailyEntry> userEntries)
{
    var today = DateOnly.FromDateTime(DateTime.Today);
    var days = Enumerable.Range(0, 7)
        .Select(offset => today.AddDays(offset - 6))
        .ToList();

    return days.Select(day =>
    {
        var entry = userEntries.FirstOrDefault(item => item.Date == day);
        return (object)new
        {
            period = day.ToString("MMM d"),
            waterLiters = entry?.WaterLiters ?? 0,
            exerciseMinutes = entry?.ExerciseMinutes ?? 0,
            sleepHours = entry?.SleepHours ?? 0,
            steps = entry?.Steps ?? 0,
            moneySpent = entry?.MoneySpent ?? 0,
        };
    }).ToList();
}

static List<object> BuildMonthlyTrend(List<DailyEntry> userEntries)
{
    var now = DateTime.Today;
    var months = Enumerable.Range(0, 6)
        .Select(offset =>
        {
            var monthStart = new DateTime(now.Year, now.Month, 1).AddMonths(offset - 5);
            var monthEnd = monthStart.AddMonths(1).AddDays(-1);
            var monthEntries = userEntries.Where(item =>
                item.Date >= DateOnly.FromDateTime(monthStart) &&
                item.Date <= DateOnly.FromDateTime(monthEnd)).ToList();

            return (object)new
            {
                period = monthStart.ToString("MMM yyyy"),
                waterLiters = monthEntries.Count == 0 ? 0 : Math.Round(monthEntries.Average(item => item.WaterLiters), 2),
                exerciseMinutes = monthEntries.Count == 0 ? 0 : Math.Round(monthEntries.Average(item => item.ExerciseMinutes), 2),
                sleepHours = monthEntries.Count == 0 ? 0 : Math.Round(monthEntries.Average(item => item.SleepHours), 2),
                steps = monthEntries.Count == 0 ? 0 : Math.Round(monthEntries.Average(item => item.Steps), 2),
                moneySpent = monthEntries.Count == 0 ? 0 : Math.Round(monthEntries.Average(item => item.MoneySpent), 2),
            };
        })
        .ToList();

    return months;
}

static List<Dictionary<string, object>> BuildWeeklyCompare(List<AppUser> users, List<DailyEntry> entries, string metric)
{
    var today = DateOnly.FromDateTime(DateTime.Today);
    var days = Enumerable.Range(0, 7)
        .Select(offset => today.AddDays(offset - 6))
        .ToList();

    return days.Select(day =>
    {
        var row = new Dictionary<string, object>
        {
            ["period"] = day.ToString("MMM d"),
        };

        foreach (var user in users)
        {
            var entry = entries.FirstOrDefault(item => item.UserId == user.Id && item.Date == day);
            row[user.Name] = entry is null ? 0 : GetMetric(entry, metric);
        }

        return row;
    }).ToList();
}

static List<Dictionary<string, object>> BuildMonthlyCompare(List<AppUser> users, List<DailyEntry> entries, string metric)
{
    var now = DateTime.Today;
    var months = Enumerable.Range(0, 6)
        .Select(offset => new DateTime(now.Year, now.Month, 1).AddMonths(offset - 5))
        .ToList();

    return months.Select(monthStart =>
    {
        var monthEnd = monthStart.AddMonths(1).AddDays(-1);
        var row = new Dictionary<string, object>
        {
            ["period"] = monthStart.ToString("MMM yyyy"),
        };

        foreach (var user in users)
        {
            var monthEntries = entries.Where(item =>
                item.UserId == user.Id &&
                item.Date >= DateOnly.FromDateTime(monthStart) &&
                item.Date <= DateOnly.FromDateTime(monthEnd)).ToList();

            row[user.Name] = monthEntries.Count == 0
                ? 0
                : Math.Round(monthEntries.Average(item => GetMetric(item, metric)), 2);
        }

        return row;
    }).ToList();
}

static async Task<List<Dictionary<string, object>>> BuildTodayCompareAsync(
    string connectionString,
    List<AppUser> users,
    string metric)
{
    var today = DateOnly.FromDateTime(DateTime.Today);
    var userIds = users
        .Select(user => long.TryParse(user.Id, out var id) ? id : 0)
        .Where(id => id > 0)
        .ToHashSet();
    var liveEntries = await LoadLiveEntriesForDateAsync(connectionString, today);
    var dayEntries = await LoadDayEntriesForDateAsync(connectionString, today);

    var row = new Dictionary<string, object>
    {
        ["period"] = today.ToString("MMM d"),
    };

    foreach (var user in users)
    {
        if (!long.TryParse(user.Id, out var userIdValue) || !userIds.Contains(userIdValue))
        {
            row[user.Name] = 0;
            continue;
        }

        var liveEntry = liveEntries.FirstOrDefault(item => item.UserId == user.Id);
        var dayEntry = dayEntries.FirstOrDefault(item => item.UserId == user.Id);
        var chosenEntry = liveEntry ?? dayEntry;
        row[user.Name] = chosenEntry is null ? 0 : GetMetric(chosenEntry, metric);
    }

    return [row];
}

static async Task<List<DailyEntry>> LoadLiveEntriesForDateAsync(string connectionString, DateOnly date)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent
        FROM live_entries
        WHERE entry_date = @entryDate;
        """,
        connection);
    command.Parameters.AddWithValue("@entryDate", date.ToDateTime(TimeOnly.MinValue));

    try
    {
        return await ReadEntriesAsync(command);
    }
    catch (MySqlException ex) when (ex.Number == 1146)
    {
        return [];
    }
}

static async Task<List<DailyEntry>> LoadDayEntriesForDateAsync(string connectionString, DateOnly date)
{
    await using var connection = new MySqlConnection(connectionString);
    await connection.OpenAsync();

    await using var command = new MySqlCommand(
        """
        SELECT user_id, entry_date, water_liters, exercise_minutes, sleep_hours, steps, money_spent
        FROM daily_entries
        WHERE entry_date = @entryDate;
        """,
        connection);
    command.Parameters.AddWithValue("@entryDate", date.ToDateTime(TimeOnly.MinValue));
    return await ReadEntriesAsync(command);
}

static async Task<object> BuildDashboardSummaryAsync(string connectionString, long userId, List<DailyEntry> userEntries, int currentStreakDays)
{
    var daysCompleted = userEntries.Select(item => item.Date).Distinct().Count();
    const int calibrationDaysRequired = 7;
    var calibrationDaysCompleted = Math.Min(daysCompleted, calibrationDaysRequired);
    var isScoreCalibrated = daysCompleted >= calibrationDaysRequired;
    int? averageScore = null;
    var goals = await LoadUserGoalsAsync(connectionString, userId) ?? GetDefaultGoals();
    var latestEntries = userEntries
        .GroupBy(item => item.Date)
        .ToDictionary(group => group.Key, group => group.OrderByDescending(item => item.Date).First());
    var scoringDays = latestEntries.Keys
        .OrderByDescending(item => item)
        .Take(calibrationDaysRequired)
        .ToList();

    if (scoringDays.Count > 0)
    {
        var dailyScores = scoringDays
            .Select(day => GetDailyScore(latestEntries[day], goals))
            .ToList();
        averageScore = (int)Math.Round(dailyScores.Average(), MidpointRounding.AwayFromZero);
    }

    var bestStreak = Math.Max(currentStreakDays, CalculateBestStreak(userEntries));

    return new
    {
        daysCompleted,
        averageScore,
        isScoreCalibrated,
        calibrationDaysRequired,
        calibrationDaysCompleted,
        bestStreak,
    };
}

static List<object> BuildBestRecords(List<DailyEntry> userEntries)
{
    if (userEntries.Count == 0)
    {
        return [];
    }

    var water = userEntries
        .OrderByDescending(item => item.WaterLiters)
        .ThenByDescending(item => item.Date)
        .First();
    var exercise = userEntries
        .OrderByDescending(item => item.ExerciseMinutes)
        .ThenByDescending(item => item.Date)
        .First();
    var sleep = userEntries
        .OrderByDescending(item => item.SleepHours)
        .ThenByDescending(item => item.Date)
        .First();
    var steps = userEntries
        .OrderByDescending(item => item.Steps)
        .ThenByDescending(item => item.Date)
        .First();
    var money = userEntries
        .OrderBy(item => item.MoneySpent)
        .ThenByDescending(item => item.Date)
        .First();

    return
    [
        new { metric = "waterLiters", value = water.WaterLiters, date = water.Date.ToString("yyyy-MM-dd") },
        new { metric = "exerciseMinutes", value = exercise.ExerciseMinutes, date = exercise.Date.ToString("yyyy-MM-dd") },
        new { metric = "sleepHours", value = sleep.SleepHours, date = sleep.Date.ToString("yyyy-MM-dd") },
        new { metric = "steps", value = steps.Steps, date = steps.Date.ToString("yyyy-MM-dd") },
        new { metric = "moneySpent", value = money.MoneySpent, date = money.Date.ToString("yyyy-MM-dd") },
    ];
}

static int GetDailyScore(DailyEntry entry, UserGoals goals)
{
    var completedCount = 0;
    if (entry.WaterLiters >= goals.WaterLiters)
    {
        completedCount++;
    }

    if (entry.ExerciseMinutes >= goals.ExerciseMinutes)
    {
        completedCount++;
    }

    if (entry.SleepHours >= goals.SleepHours)
    {
        completedCount++;
    }

    if (entry.Steps >= goals.Steps)
    {
        completedCount++;
    }

    if (entry.MoneySpent <= goals.MoneySpent)
    {
        completedCount++;
    }

    return (int)Math.Round((completedCount / 5m) * 100m, MidpointRounding.AwayFromZero);
}

static UserGoals GetDefaultGoals()
{
    return new UserGoals(2m, 45, 8m, 10000, 20m);
}

static int CalculateBestStreak(List<DailyEntry> userEntries)
{
    var days = userEntries
        .Select(item => item.Date)
        .Distinct()
        .OrderBy(item => item)
        .ToList();

    if (days.Count == 0)
    {
        return 0;
    }

    var best = 1;
    var current = 1;
    for (var index = 1; index < days.Count; index++)
    {
        if (days[index].DayNumber - days[index - 1].DayNumber == 1)
        {
            current++;
            if (current > best)
            {
                best = current;
            }
        }
        else
        {
            current = 1;
        }
    }

    return best;
}

static decimal GetMetric(DailyEntry entry, string metric)
{
    return metric switch
    {
        "waterLiters" => entry.WaterLiters,
        "exerciseMinutes" => entry.ExerciseMinutes,
        "sleepHours" => entry.SleepHours,
        "steps" => entry.Steps,
        "moneySpent" => entry.MoneySpent,
        _ => 0,
    };
}

record AppUser(string Id, string Name, int StreakDays, string JoinDate);

record SignupRequest(string Username, string Password, string? DisplayName);
record LoginRequest(string Username, string Password);
record SaveUserRoomRequest(string RoomCode);
record UserGoals(decimal WaterLiters, int ExerciseMinutes, decimal SleepHours, int Steps, decimal MoneySpent);
record GoalMetricNames(string Water, string Exercise, string Sleep, string Steps, string Money);

record SaveUserGoalsRequest(
    decimal WaterLiters,
    int ExerciseMinutes,
    decimal SleepHours,
    int Steps,
    decimal MoneySpent)
{
    public bool IsValid()
    {
        return WaterLiters > 0 &&
               ExerciseMinutes > 0 &&
               SleepHours > 0 &&
               Steps > 0 &&
               MoneySpent >= 0;
    }
}

class DailyEntry(
    string userId,
    DateOnly date,
    decimal waterLiters,
    int exerciseMinutes,
    decimal sleepHours,
    int steps,
    decimal moneySpent)
{
    public string UserId { get; set; } = userId;
    public DateOnly Date { get; set; } = date;
    public decimal WaterLiters { get; set; } = waterLiters;
    public int ExerciseMinutes { get; set; } = exerciseMinutes;
    public decimal SleepHours { get; set; } = sleepHours;
    public int Steps { get; set; } = steps;
    public decimal MoneySpent { get; set; } = moneySpent;
}

record SaveEntryRequest(
    string UserId,
    string Date,
    decimal WaterLiters,
    int ExerciseMinutes,
    decimal SleepHours,
    int Steps,
    decimal MoneySpent);
