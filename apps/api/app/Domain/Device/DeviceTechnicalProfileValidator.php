<?php

namespace App\Domain\Device;

class DeviceTechnicalProfileValidator
{
    /** @var array<string, array<string, string>> */
    private const SCHEMAS = [
        'desktop_pc' => ['processor' => 'string', 'ramGB' => 'positive_number', 'storageGB' => 'positive_number', 'gpu' => 'string', 'os' => 'string'],
        'laptop' => ['processor' => 'string', 'ramGB' => 'positive_number', 'storageGB' => 'positive_number', 'gpu' => 'string', 'os' => 'string', 'display' => 'string'],
        'server' => ['processor' => 'string', 'cpuSockets' => 'positive_integer', 'cpuCores' => 'positive_integer', 'ramGB' => 'positive_number', 'storageGB' => 'positive_number', 'raidLevel' => 'string', 'os' => 'string'],
        'network_switch' => ['portCount' => 'positive_integer', 'managed' => 'boolean', 'poe' => 'boolean', 'poeBudgetWatts' => 'nonnegative_number', 'switchingCapacityGbps' => 'nonnegative_number', 'uplinkSpeedGbps' => 'nonnegative_number', 'firmwareVersion' => 'string'],
        'router' => ['wanPortCount' => 'nonnegative_integer', 'lanPortCount' => 'nonnegative_integer', 'throughputMbps' => 'nonnegative_number', 'wifiCapable' => 'boolean', 'firmwareVersion' => 'string'],
        'access_point' => ['wifiStandard' => 'string', 'bands' => 'bands', 'maxClients' => 'nonnegative_integer', 'poe' => 'boolean', 'firmwareVersion' => 'string'],
        'printer' => ['technology' => 'printer_technology', 'color' => 'boolean', 'duplex' => 'boolean', 'networkCapable' => 'boolean', 'paperSize' => 'string'],
        'projector' => ['technology' => 'string', 'brightnessLumens' => 'nonnegative_number', 'nativeResolution' => 'string'],
        'ups' => ['capacityVA' => 'nonnegative_number', 'powerWatts' => 'nonnegative_number', 'batteryCount' => 'nonnegative_integer', 'batteryVoltage' => 'nonnegative_number', 'runtimeMinutes' => 'nonnegative_number'],
    ];

    /** @return array<string, list<string>> */
    public function validate(string $deviceType, mixed $profile): array
    {
        if (! is_array($profile) || array_is_list($profile) && $profile !== []) {
            return ['technicalProfile' => ['The technical profile must be a JSON object.']];
        }

        if ($deviceType === 'other') {
            return $this->validateOther($profile);
        }

        $schema = self::SCHEMAS[$deviceType] ?? [];
        $errors = [];
        foreach ($profile as $field => $value) {
            $path = 'technicalProfile.'.$field;
            $rule = $schema[$field] ?? null;
            if ($rule === null || ! $this->matches($rule, $value)) {
                $errors[$path] = ['The '.$path.' field is invalid.'];
            }
        }

        $encoded = json_encode($profile);
        if ($encoded === false || strlen($encoded) > 16 * 1024) {
            $errors['technicalProfile'] = ['The technical profile may not exceed 16 KiB.'];
        }

        return $errors;
    }

    /** @param array<string, mixed> $profile @return array<string, mixed> */
    public function normalize(array $profile): array
    {
        return array_map(fn (mixed $value): mixed => is_string($value) ? trim($value) : $value, $profile);
    }

    private function matches(string $rule, mixed $value): bool
    {
        return match ($rule) {
            'string' => is_string($value) && mb_strlen(trim($value)) >= 1 && mb_strlen(trim($value)) <= 255,
            'boolean' => is_bool($value),
            'positive_number' => $this->finiteNumber($value) && $value > 0,
            'nonnegative_number' => $this->finiteNumber($value) && $value >= 0,
            'positive_integer' => is_int($value) && $value > 0,
            'nonnegative_integer' => is_int($value) && $value >= 0,
            'bands' => is_array($value) && array_is_list($value) && count($value) === count(array_unique($value))
                && array_diff($value, ['2.4GHz', '5GHz', '6GHz']) === [],
            'printer_technology' => is_string($value) && in_array($value, ['inkjet', 'laser', 'dot_matrix', 'thermal', 'other'], true),
            default => false,
        };
    }

    private function finiteNumber(mixed $value): bool
    {
        return (is_int($value) || is_float($value)) && is_finite((float) $value);
    }

    /** @param array<string, mixed> $profile @return array<string, list<string>> */
    private function validateOther(array $profile): array
    {
        $errors = [];
        if (count($profile) > 32) {
            $errors['technicalProfile'] = ['The technical profile may not contain more than 32 properties.'];
        }
        foreach ($profile as $field => $value) {
            $path = 'technicalProfile.'.$field;
            $validKey = preg_match('/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/', (string) $field) === 1;
            $validValue = is_null($value) || is_bool($value) || $this->finiteNumber($value)
                || is_string($value) && mb_strlen($value) <= 500;
            if (! $validKey || ! $validValue) {
                $errors[$path] = ['The '.$path.' field is invalid.'];
            }
        }
        $encoded = json_encode($profile);
        if ($encoded === false || strlen($encoded) > 16 * 1024) {
            $errors['technicalProfile'] = ['The technical profile may not exceed 16 KiB.'];
        }

        return $errors;
    }
}
