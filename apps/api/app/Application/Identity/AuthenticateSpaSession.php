<?php

namespace App\Application\Identity;

use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Auth\Factory as AuthFactory;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Support\Str;
use LogicException;

class AuthenticateSpaSession
{
    public const MAX_ATTEMPTS = 5;

    public const DECAY_SECONDS = 60;

    public function __construct(
        private readonly AuthFactory $auth,
        private readonly RateLimiter $rateLimiter,
    ) {}

    public function handle(
        string $email,
        #[\SensitiveParameter] string $password,
        bool $remember,
        string $ipAddress,
    ): void {
        $throttleKey = $this->throttleKey($email, $ipAddress);

        if ($this->rateLimiter->tooManyAttempts($throttleKey, self::MAX_ATTEMPTS)) {
            throw SpaAuthenticationException::tooManyLoginAttempts(
                $this->rateLimiter->availableIn($throttleKey),
            );
        }

        $guard = $this->auth->guard('web');

        if (! $guard instanceof StatefulGuard) {
            throw new LogicException('The web authentication guard must be stateful.');
        }

        $authenticated = $guard->attempt([
            'email' => $email,
            'password' => $password,
            'status' => 'active',
        ], $remember);

        if (! $authenticated) {
            $this->rateLimiter->hit($throttleKey, self::DECAY_SECONDS);

            throw SpaAuthenticationException::invalidCredentials();
        }

        $this->rateLimiter->clear($throttleKey);
    }

    public function throttleKey(string $email, string $ipAddress): string
    {
        $identity = Str::lower(Str::transliterate($email)).'|'.$ipAddress;

        return 'spa-session-login:'.hash('sha256', $identity);
    }
}
