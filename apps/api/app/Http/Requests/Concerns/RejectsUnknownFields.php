<?php

namespace App\Http\Requests\Concerns;

use Illuminate\Validation\Validator;

trait RejectsUnknownFields
{
    /** @param list<string> $recognized */
    private function rejectUnknownBodyFields(Validator $validator, array $recognized): void
    {
        foreach (array_diff(array_keys($this->all()), $recognized) as $field) {
            $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
        }
    }

    /** @param list<string> $recognized */
    private function rejectUnknownQueryFields(Validator $validator, array $recognized): void
    {
        foreach (array_diff(array_keys($this->query()), $recognized) as $field) {
            $validator->errors()->add((string) $field, "The {$field} query parameter is prohibited.");
        }
    }
}
