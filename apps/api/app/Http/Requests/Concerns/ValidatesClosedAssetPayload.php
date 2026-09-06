<?php

namespace App\Http\Requests\Concerns;

use Illuminate\Validation\Validator;

trait ValidatesClosedAssetPayload
{
    /** @param list<string> $recognized */
    private function rejectUnknownAssetFields(Validator $validator, array $recognized): void
    {
        foreach (array_diff(array_keys($this->all()), $recognized) as $field) {
            $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
        }
    }

    /** @param list<string> $fields */
    private function normalizeNullableAssetStrings(array $fields): void
    {
        $normalized = [];
        foreach ($fields as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $normalized[$field] = $value === '' ? null : $value;
            }
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }
}
