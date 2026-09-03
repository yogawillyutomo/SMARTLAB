<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IdentityRoleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->key,
            'name' => $this->name,
            'permissions' => $this->permissions->pluck('key')->sort()->values()->all(),
            'membershipCount' => (int) $this->membership_count,
            'activeMembershipCount' => (int) $this->active_membership_count,
        ];
    }
}
