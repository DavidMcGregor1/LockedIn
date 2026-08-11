using System.Globalization;

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

var mysqlConnectionString = BuildMySqlConnectionString(builder.Configuration);
if (mysqlConnectionString is not null)
{
    builder.Configuration["ConnectionStrings:MySql"] = mysqlConnectionString;
}

builder.Services.AddOpenApi();
builder.Services.AddCors(options =>
{
    options.AddPolicy(
        "frontend",
        policy => policy.WithOrigins("http://localhost:5173").AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

var users = new List<AppUser>
{
    new("david", "David", 21, "2026-03-14"),
    new("mason", "Mason", 17, "2026-03-14"),
    new("leo", "Leo", 14, "2026-03-14"),
};

var entries = SeedEntries(users);
var metricKeys = new HashSet<string>
{
    "waterLiters",
    "exerciseMinutes",
    "sleepHours",
    "steps",
    "moneySpent",
};

app.MapGet("/api/users", () => users);

app.MapGet("/api/today/{userId}", (string userId) =>
{
    if (!users.Any(user => user.Id == userId))
    {
        return Results.NotFound();
    }

    var today = DateOnly.FromDateTime(DateTime.Today);
    var entry = entries.FirstOrDefault(item => item.UserId == userId && item.Date == today);
    return Results.Ok(entry);
});

app.MapPost("/api/entries", (SaveEntryRequest request) =>
{
    if (!users.Any(user => user.Id == request.UserId))
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

    var existing = entries.FirstOrDefault(item => item.UserId == request.UserId && item.Date == date);

    if (existing is null)
    {
        entries.Add(
            new DailyEntry(
                request.UserId,
                date,
                request.WaterLiters,
                request.ExerciseMinutes,
                request.SleepHours,
                request.Steps,
                request.MoneySpent));
    }
    else
    {
        existing.WaterLiters = request.WaterLiters;
        existing.ExerciseMinutes = request.ExerciseMinutes;
        existing.SleepHours = request.SleepHours;
        existing.Steps = request.Steps;
        existing.MoneySpent = request.MoneySpent;
    }

    return Results.NoContent();
});

app.MapGet("/api/dashboard/{userId}", (string userId) =>
{
    var user = users.FirstOrDefault(item => item.Id == userId);
    if (user is null)
    {
        return Results.NotFound();
    }

    var userEntries = entries.Where(item => item.UserId == userId).ToList();
    var weeklyTrend = BuildWeeklyTrend(userEntries);
    var monthlyTrend = BuildMonthlyTrend(userEntries);
    var summary = BuildDashboardSummary(userEntries, user.StreakDays);
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

app.MapGet("/api/compare", (string metric, string? range) =>
{
    var metricKey = metric.Trim();
    if (!metricKeys.Contains(metricKey))
    {
        return Results.BadRequest(new { error = "Unsupported metric." });
    }

    var effectiveRange = string.Equals(range, "monthly", StringComparison.OrdinalIgnoreCase) ? "monthly" : "weekly";

    var compareRows = effectiveRange == "monthly"
        ? BuildMonthlyCompare(users, entries, metricKey)
        : BuildWeeklyCompare(users, entries, metricKey);

    return Results.Ok(new { metric = metricKey, data = compareRows });
});

app.Run();

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

    return $"Server={mysqlHost};Port={mysqlPort};Database={mysqlDatabase};User={mysqlUsername};Password={mysqlPassword};SslMode={mysqlSslMode};AllowPublicKeyRetrieval=True;TreatTinyAsBoolean=True;";
}

static List<DailyEntry> SeedEntries(List<AppUser> users)
{
    var random = new Random(13);
    var data = new List<DailyEntry>();
    var today = DateOnly.FromDateTime(DateTime.Today);

    for (var offset = 0; offset < 120; offset++)
    {
        var date = today.AddDays(-offset);
        foreach (var user in users)
        {
            data.Add(
                new DailyEntry(
                    user.Id,
                    date,
                    Math.Round(1.2m + (decimal)random.NextDouble() * 2.2m, 1),
                    random.Next(10, 95),
                    Math.Round(5.5m + (decimal)random.NextDouble() * 3.2m, 1),
                    random.Next(2500, 14500),
                    Math.Round((decimal)random.NextDouble() * 42, 2)));
        }
    }

    return data;
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

static object BuildDashboardSummary(List<DailyEntry> userEntries, int currentStreakDays)
{
    var daysCompleted = userEntries.Select(item => item.Date).Distinct().Count();
    var averageScore = userEntries.Count == 0
        ? 0
        : (int)Math.Round(userEntries.Average(GetDailyScore), MidpointRounding.AwayFromZero);
    var bestStreak = Math.Max(currentStreakDays, CalculateBestStreak(userEntries));

    return new
    {
        daysCompleted,
        averageScore,
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

static decimal GetDailyScore(DailyEntry entry)
{
    var completedCount = 0;
    if (entry.WaterLiters >= 3)
    {
        completedCount++;
    }

    if (entry.ExerciseMinutes >= 45)
    {
        completedCount++;
    }

    if (entry.SleepHours >= 8)
    {
        completedCount++;
    }

    if (entry.Steps >= 10000)
    {
        completedCount++;
    }

    if (entry.MoneySpent <= 50)
    {
        completedCount++;
    }

    return completedCount * 20m;
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
