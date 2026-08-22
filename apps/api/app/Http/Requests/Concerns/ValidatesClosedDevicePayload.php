<?php

namespace App\Http\Requests\Concerns;

use App\Domain\Device\DeviceTechnicalProfileValidator;
use Illuminate\Validation\Validator;

trait ValidatesClosedDevicePayload
{
    /** @param list<string> $recognized */
    private function rejectUnknownFields(Validator $validator, array $recognized): void
    {
        foreach (array_diff(array_keys($this->all()), $recognized) as $field) {
            $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
        }
    }

    private function validateTechnicalProfile(Validator $validator, string $deviceType): void
    {
        if (! $this->exists('technicalProfile')) {
            return;
        }

        $decoded = json_decode($this->getContent());
        if (! is_object($decoded) || ! property_exists($decoded, 'technicalProfile') || ! is_object($decoded->technicalProfile)) {
            $validator->errors()->add('technicalProfile', 'The technical profile must be a JSON object.');

            return;
        }

        /** @var DeviceTechnicalProfileValidator $profileValidator */
        $profileValidator = app(DeviceTechnicalProfileValidator::class);
        foreach ($profileValidator->validate($deviceType, $this->input('technicalProfile')) as $field => $messages) {
            foreach ($messages as $message) {
                $validator->errors()->add($field, $message);
            }
        }
    }

    private function normalizeNullableStrings(): void
    {
        $normalized = [];
        foreach (['serialNumber', 'hostname', 'brand', 'model'] as $field) {
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
