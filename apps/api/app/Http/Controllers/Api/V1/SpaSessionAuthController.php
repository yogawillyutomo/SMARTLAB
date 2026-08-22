<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\AuthenticateSpaSession;
use App\Http\Controllers\Controller;
use App\Http\Requests\SpaSessionLoginRequest;
use Illuminate\Auth\RequestGuard;
use Illuminate\Auth\SessionGuard;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

class SpaSessionAuthController extends Controller
{
    public function login(
        SpaSessionLoginRequest $request,
        AuthenticateSpaSession $authenticate,
    ): Response {
        $authenticate->handle(
            email: (string) $request->validated('email'),
            password: (string) $request->validated('password'),
            remember: $request->boolean('remember'),
            ipAddress: $request->ip() ?? 'unknown',
        );

        return response()->noContent();
    }

    public function logout(Request $request): Response
    {
        /** @var SessionGuard $guard */
        $guard = Auth::guard('web');
        $guard->logoutCurrentDevice();

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        /** @var RequestGuard $sanctumGuard */
        $sanctumGuard = Auth::guard('sanctum');
        $sanctumGuard->forgetUser();

        return response()->noContent();
    }
}
