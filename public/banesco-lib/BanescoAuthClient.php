<?php
/**
 * BanescoAuthClient — OAuth2 client_credentials contra el SSO Keycloak
 * de Banesco. Cachea el access_token en un archivo privado hasta su
 * expiración para no pedir uno nuevo en cada run del poller.
 *
 * Endpoint típico (viene de /private/higo-banesco.php):
 *   https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/
 *       realm-api-prd/protocol/openid-connect/token
 *
 * Grant: client_credentials. El body es
 *   grant_type=client_credentials&client_id=...&client_secret=...
 */

final class BanescoAuthClient
{
    private string $ssoUrl;
    private string $clientId;
    private string $clientSecret;
    private string $tokenCachePath;
    private int $timeoutSec;
    private ?string $logPath;

    public function __construct(
        string $ssoUrl,
        string $clientId,
        string $clientSecret,
        string $tokenCachePath,
        int $timeoutSec = 15,
        ?string $logPath = null
    ) {
        $this->ssoUrl = $ssoUrl;
        $this->clientId = $clientId;
        $this->clientSecret = $clientSecret;
        $this->tokenCachePath = $tokenCachePath;
        $this->timeoutSec = $timeoutSec;
        $this->logPath = $logPath;
    }

    /**
     * Devuelve un access_token válido. Usa cache si quedan >30s de vida.
     */
    public function getAccessToken(): string
    {
        $cached = $this->readCache();
        if ($cached !== null) {
            return $cached;
        }

        $fresh = $this->requestToken();
        $this->writeCache($fresh['access_token'], $fresh['expires_in']);
        return $fresh['access_token'];
    }

    private function readCache(): ?string
    {
        if (!is_file($this->tokenCachePath)) return null;
        $raw = @file_get_contents($this->tokenCachePath);
        if ($raw === false) return null;
        $data = json_decode($raw, true);
        if (!is_array($data)) return null;
        $expiresAt = $data['expires_at'] ?? 0;
        if (empty($data['access_token']) || (time() + 30) >= $expiresAt) {
            return null;
        }
        return (string) $data['access_token'];
    }

    private function writeCache(string $token, int $expiresIn): void
    {
        $payload = [
            'access_token' => $token,
            'expires_at'   => time() + max(60, (int) $expiresIn),
            'cached_at'    => time(),
        ];
        $tmp = $this->tokenCachePath . '.tmp';
        @file_put_contents($tmp, json_encode($payload));
        @chmod($tmp, 0600);
        @rename($tmp, $this->tokenCachePath);
    }

    /**
     * @return array ['access_token' => string, 'expires_in' => int]
     */
    private function requestToken(): array
    {
        $ch = curl_init($this->ssoUrl);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeoutSec,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/x-www-form-urlencoded',
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS => http_build_query([
                'grant_type'    => 'client_credentials',
                'client_id'     => $this->clientId,
                'client_secret' => $this->clientSecret,
            ]),
        ]);

        $raw = curl_exec($ch);
        $err = curl_error($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false) {
            throw new RuntimeException("Banesco SSO cURL error: {$err}");
        }
        if ($status < 200 || $status >= 300) {
            $this->log("SSO returned HTTP {$status}: " . substr((string) $raw, 0, 300));
            throw new RuntimeException("Banesco SSO HTTP {$status}");
        }

        $data = json_decode($raw, true);
        if (!is_array($data) || empty($data['access_token'])) {
            throw new RuntimeException('Banesco SSO response missing access_token');
        }
        return [
            'access_token' => (string) $data['access_token'],
            'expires_in'   => (int) ($data['expires_in'] ?? 300),
        ];
    }

    private function log(string $msg): void
    {
        if (!$this->logPath) return;
        @file_put_contents(
            $this->logPath,
            '[' . gmdate('c') . '] BanescoAuthClient: ' . $msg . "\n",
            FILE_APPEND
        );
    }
}
