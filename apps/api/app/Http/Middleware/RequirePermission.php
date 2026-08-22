<?php

namespace App\Http\Middleware;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Identity\MembershipContextException;
use App\Application\Identity\ResolveCurrentMembershipContext;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequirePermission
{
    public function __construct(
        private readonly ResolveCurrentMembershipContext $resolveContext,
    ) {}

    public function handle(Request $request, Closure $next, string $permission): Response
    {
        /** @var User $user */
        $user = $request->user();

        try {
            $context = $this->resolveContext->for($user);
        } catch (MembershipContextException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
            ], $exception->status);
        }

        if (! $context->permissions->contains($permission)) {
            return response()->json([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ], 403);
        }

        $request->attributes->set(CurrentMembershipContext::class, $context);

        return $next($request);
    }
}
