<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\MembershipContextException;
use App\Application\Identity\ResolveCurrentMembershipContext;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeController
{
    public function __invoke(Request $request, ResolveCurrentMembershipContext $resolveContext): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        try {
            $context = $resolveContext->for($user);
        } catch (MembershipContextException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => $exception->errorCode,
            ], $exception->status);
        }

        $membership = $context->membership;

        return response()->json([
            'data' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'school' => [
                    'id' => $membership->school->id,
                    'code' => $membership->school->code,
                    'name' => $membership->school->name,
                ],
                'membership' => [
                    'id' => $membership->id,
                    'status' => $membership->status,
                    'roles' => $membership->roles->sortBy('name')->pluck('name')->values(),
                ],
                'permissions' => $context->permissions,
            ],
        ]);
    }
}
