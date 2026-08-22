<?php

namespace Tests\Feature;

use App\Application\Identity\AuthenticateSpaSession;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class SpaSessionAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    private const SPA_ORIGIN = 'http://localhost';

    private const CLIENT_IP = '203.0.113.10';

    public function test_valid_credentials_create_a_session_and_return_exactly_204_without_issuing_a_token(): void
    {
        $user = User::factory()->create([
            'email' => 'admin@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();

        $response = $this->postJson('/api/v1/auth/login', [
            'email' => 'admin@example.test',
            'password' => 'correct-password',
        ]);

        $response->assertNoContent();
        $this->assertSame('', $response->getContent());
        $this->assertAuthenticatedAs($user, 'web');
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_successful_login_regenerates_the_session_identifier(): void
    {
        User::factory()->create([
            'email' => 'session@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();
        $this->withSession(['pre_login_marker' => true]);
        $previousSessionId = session()->getId();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'session@example.test',
            'password' => 'correct-password',
        ])->assertNoContent();

        $this->assertNotSame($previousSessionId, session()->getId());
        $this->assertTrue(session()->get('pre_login_marker'));
    }

    public function test_wrong_password_unknown_email_and_inactive_account_share_the_same_stable_response(): void
    {
        User::factory()->create([
            'email' => 'known@example.test',
            'password' => 'correct-password',
        ]);
        User::factory()->create([
            'email' => 'inactive@example.test',
            'password' => 'correct-password',
            'status' => 'inactive',
        ]);
        $this->prepareSpaClient();
        $expected = [
            'message' => 'The provided credentials are invalid.',
            'code' => 'INVALID_CREDENTIALS',
        ];

        $wrongPassword = $this->postJson('/api/v1/auth/login', [
            'email' => 'known@example.test',
            'password' => 'wrong-password',
        ])->assertUnauthorized()->assertExactJson($expected);

        $unknownEmail = $this->postJson('/api/v1/auth/login', [
            'email' => 'unknown@example.test',
            'password' => 'wrong-password',
        ])->assertUnauthorized()->assertExactJson($expected);

        $inactiveAccount = $this->postJson('/api/v1/auth/login', [
            'email' => 'inactive@example.test',
            'password' => 'correct-password',
        ])->assertUnauthorized()->assertExactJson($expected);

        $this->assertSame($wrongPassword->getContent(), $unknownEmail->getContent());
        $this->assertSame($wrongPassword->getContent(), $inactiveAccount->getContent());
        $this->assertGuest('web');
    }

    public function test_login_validates_required_fields_and_types_with_the_existing_error_contract(): void
    {
        $this->prepareSpaClient();

        $this->postJson('/api/v1/auth/login', [])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors(['email', 'password']);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'not-an-email',
            'password' => ['not-a-string'],
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_login_rejects_unknown_request_fields(): void
    {
        User::factory()->create([
            'email' => 'closed@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'closed@example.test',
            'password' => 'correct-password',
            'schoolId' => (string) Str::ulid(),
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('schoolId');

        $this->assertGuest('web');
    }

    public function test_remember_accepts_only_json_boolean_values(): void
    {
        User::factory()->create([
            'email' => 'remember@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();

        foreach ([1, 0, '1', '0', 'true', 'false'] as $invalidRemember) {
            $this->postJson('/api/v1/auth/login', [
                'email' => 'remember@example.test',
                'password' => 'correct-password',
                'remember' => $invalidRemember,
            ])->assertUnprocessable()->assertJsonValidationErrors('remember');
        }

        $this->postJson('/api/v1/auth/login', [
            'email' => 'remember@example.test',
            'password' => 'correct-password',
            'remember' => true,
        ])->assertNoContent();
    }

    public function test_login_throttling_returns_the_stable_429_response(): void
    {
        User::factory()->create([
            'email' => 'throttle@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();

        for ($attempt = 0; $attempt < AuthenticateSpaSession::MAX_ATTEMPTS; $attempt++) {
            $this->postJson('/api/v1/auth/login', [
                'email' => 'throttle@example.test',
                'password' => 'wrong-password',
            ])->assertUnauthorized()->assertJsonPath('code', 'INVALID_CREDENTIALS');
        }

        $this->postJson('/api/v1/auth/login', [
            'email' => 'throttle@example.test',
            'password' => 'wrong-password',
        ])
            ->assertTooManyRequests()
            ->assertHeader('Retry-After')
            ->assertExactJson([
                'message' => 'Too many login attempts. Please try again later.',
                'code' => 'TOO_MANY_LOGIN_ATTEMPTS',
            ]);

        $this->assertGuest('web');
    }

    public function test_successful_authentication_clears_the_email_and_ip_throttle_state(): void
    {
        $user = User::factory()->create([
            'email' => 'clear@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();
        $authenticator = $this->app->make(AuthenticateSpaSession::class);
        $rateLimiter = $this->app->make(RateLimiter::class);
        $key = $authenticator->throttleKey($user->email, self::CLIENT_IP);

        for ($attempt = 0; $attempt < 2; $attempt++) {
            $this->postJson('/api/v1/auth/login', [
                'email' => $user->email,
                'password' => 'wrong-password',
            ])->assertUnauthorized();
        }

        $this->assertSame(2, $rateLimiter->attempts($key));

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'correct-password',
        ])->assertNoContent();

        $this->assertSame(0, $rateLimiter->attempts($key));
    }

    public function test_authenticated_session_can_access_the_existing_me_contract(): void
    {
        $user = User::factory()->create([
            'name' => 'Session Admin',
            'email' => 'me@example.test',
            'password' => 'correct-password',
        ]);
        $school = School::factory()->create(['code' => 'SPA-01', 'name' => 'SPA School']);
        $membership = $this->activeMembership($user, $school);
        $this->prepareSpaClient();

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'correct-password',
        ])->assertNoContent();

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.id', $user->id)
            ->assertJsonPath('data.school.id', $school->id)
            ->assertJsonPath('data.membership.id', $membership->id);
    }

    public function test_login_does_not_bypass_the_no_active_membership_error(): void
    {
        $user = User::factory()->create([
            'email' => 'no-membership@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();

        $this->login($user);

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'An active school membership is required.',
                'code' => 'ACTIVE_MEMBERSHIP_REQUIRED',
            ]);
    }

    public function test_login_does_not_bypass_the_multiple_membership_error(): void
    {
        $user = User::factory()->create([
            'email' => 'multiple@example.test',
            'password' => 'correct-password',
        ]);
        $this->activeMembership($user, School::factory()->create());
        $this->activeMembership($user, School::factory()->create());
        $this->prepareSpaClient();

        $this->login($user);

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'A school context must be selected before this request can continue.',
                'code' => 'SCHOOL_CONTEXT_REQUIRED',
            ]);
    }

    public function test_authenticated_logout_invalidates_only_the_current_session_and_returns_exactly_204(): void
    {
        $user = User::factory()->create([
            'email' => 'logout@example.test',
            'password' => 'correct-password',
        ]);
        $this->prepareSpaClient();
        $this->login($user);
        session()->put('logout_marker', true);
        $previousSessionId = session()->getId();
        $previousCsrfToken = session()->token();

        $response = $this->postJson('/api/v1/auth/logout');

        $response->assertNoContent();
        $this->assertSame('', $response->getContent());
        $this->assertGuest('web');
        $this->assertFalse(session()->has('logout_marker'));
        $this->assertNotSame($previousSessionId, session()->getId());
        $this->assertNotSame($previousCsrfToken, session()->token());
    }

    public function test_me_is_unauthenticated_after_session_logout(): void
    {
        $user = User::factory()->create([
            'email' => 'after-logout@example.test',
            'password' => 'correct-password',
        ]);
        $this->activeMembership($user, School::factory()->create());
        $this->prepareSpaClient();
        $this->login($user);

        $this->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_guest_logout_returns_the_existing_unauthenticated_response(): void
    {
        $this->prepareSpaClient();

        $this->postJson('/api/v1/auth/logout')
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_current_session_logout_does_not_cycle_the_remember_token(): void
    {
        $user = User::factory()->create([
            'email' => 'remember-logout@example.test',
            'password' => 'correct-password',
            'remember_token' => null,
        ]);
        $this->prepareSpaClient();

        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'correct-password',
            'remember' => true,
        ])->assertNoContent();

        $rememberToken = $user->refresh()->getRememberToken();
        $this->assertNotNull($rememberToken);

        $this->postJson('/api/v1/auth/logout')->assertNoContent();

        $this->assertSame($rememberToken, $user->refresh()->getRememberToken());
    }

    public function test_bearer_authenticated_logout_does_not_revoke_the_personal_access_token(): void
    {
        $user = User::factory()->create();
        $plainTextToken = $user->createToken('future-api-client')->plainTextToken;

        $this->withToken($plainTextToken)
            ->postJson('/api/v1/auth/logout')
            ->assertNoContent();

        $this->assertDatabaseCount('personal_access_tokens', 1);
        $this->assertNotNull(PersonalAccessToken::findToken($plainTextToken));

        $this->withToken($plainTextToken)
            ->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_no_unrequested_authentication_routes_are_exposed(): void
    {
        $uris = collect(Route::getRoutes()->getRoutes())->pluck('uri');

        foreach ([
            'api/v1/auth/register',
            'api/v1/auth/password/forgot',
            'api/v1/auth/password/reset',
            'api/v1/auth/token',
            'api/v1/auth/logout-all',
            'api/v1/auth/oauth',
        ] as $forbiddenUri) {
            $this->assertNotContains($forbiddenUri, $uris);
        }
    }

    private function prepareSpaClient(): void
    {
        $this->withHeaders([
            'Origin' => self::SPA_ORIGIN,
            'Referer' => self::SPA_ORIGIN.'/',
        ])->withServerVariables([
            'REMOTE_ADDR' => self::CLIENT_IP,
        ]);

        $this->get('/sanctum/csrf-cookie')->assertNoContent();
    }

    private function login(User $user): void
    {
        $this->postJson('/api/v1/auth/login', [
            'email' => $user->email,
            'password' => 'correct-password',
        ])->assertNoContent();
    }

    private function activeMembership(User $user, School $school): SchoolMembership
    {
        return SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
    }
}
