<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IdentityMembershipResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $roles = $this->roles
            ->sortBy(fn ($role) => $role->name.'|'.$role->key)
            ->values()
            ->map(fn ($role) => [
                'key' => $role->key,
                'name' => $role->name,
            ])
            ->all();

        return [
            'id' => $this->id,
            'status' => $this->status,
            'user' => [
                'id' => $this->user->id,
                'name' => $this->user->name,
                'email' => $this->user->email,
                'nip' => $this->user->nip,
                'nis' => $this->user->nis,
                'phone' => $this->user->phone,
                'status' => $this->user->status,
                'lastLoginAt' => $this->user->last_login_at?->toISOString(),
            ],
            'roles' => $roles,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
