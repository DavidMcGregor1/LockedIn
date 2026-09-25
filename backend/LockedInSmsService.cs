using System.Net.Http.Headers;
using System.Text;

sealed class LockedInSmsService(IHttpClientFactory httpClientFactory, IConfiguration configuration, ILogger<LockedInSmsService> logger)
{
    public async Task SendAsync(string phoneNumber, string message, CancellationToken cancellationToken = default)
    {
        var accountSid = configuration["Notifications:Twilio:AccountSid"]
            ?? configuration["TWILIO_ACCOUNT_SID"]
            ?? string.Empty;
        var authToken = configuration["Notifications:Twilio:AuthToken"]
            ?? configuration["TWILIO_AUTH_TOKEN"]
            ?? string.Empty;
        var fromNumber = configuration["Notifications:Twilio:FromNumber"]
            ?? configuration["TWILIO_FROM_NUMBER"]
            ?? string.Empty;

        if (string.IsNullOrWhiteSpace(accountSid) ||
            string.IsNullOrWhiteSpace(authToken) ||
            string.IsNullOrWhiteSpace(fromNumber))
        {
            throw new InvalidOperationException("Twilio SMS is not configured.");
        }

        var form = new Dictionary<string, string>
        {
            ["To"] = phoneNumber,
            ["From"] = fromNumber,
            ["Body"] = message,
        };
        var basicCredentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{accountSid}:{authToken}"));
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json")
        {
            Content = new FormUrlEncodedContent(form),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basicCredentials);

        using var response = await httpClientFactory.CreateClient().SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        logger.LogError("Twilio SMS failed with status {StatusCode}: {ResponseBody}", (int)response.StatusCode, responseBody);
        throw new InvalidOperationException($"Twilio SMS failed with status {(int)response.StatusCode}.");
    }
}
