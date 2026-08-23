<?php

namespace App\Domain\Layout;

use App\Models\Device;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class LayoutAggregateValidator
{
    /**
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public function normalize(array $data): array
    {
        $data['name'] = trim((string) $data['name']);
        $data['templateKey'] = $this->optionalString($data['templateKey'] ?? null);
        $data['structuralElements'] = array_map(function (array $element): array {
            if (array_key_exists('label', $element)) {
                $element['label'] = $this->optionalString($element['label']);
            } else {
                $element['label'] = null;
            }

            return $element;
        }, $data['structuralElements']);
        $data['devicePlacements'] = array_map(function (array $placement): array {
            $placement['role'] = $placement['role'] ?? null;
            $placement['label'] = $this->optionalString($placement['label'] ?? null);

            return $placement;
        }, $data['devicePlacements']);

        return $data;
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  Collection<string, Device>  $devicesById
     */
    public function validate(array $data, string $laboratoryId, Collection $devicesById): void
    {
        $this->validateDevices($data['devicePlacements'], $laboratoryId, $devicesById);
        $this->validateGeometry($data);
    }

    /** @param list<array<string, mixed>> $placements @param Collection<string, Device> $devicesById */
    private function validateDevices(array $placements, string $laboratoryId, Collection $devicesById): void
    {
        $seen = [];
        foreach ($placements as $index => $placement) {
            $deviceId = (string) $placement['deviceId'];
            if (isset($seen[$deviceId])) {
                throw new LayoutDomainException(
                    'A Device may be placed only once in a Layout.',
                    'LAYOUT_DEVICE_ALREADY_PLACED',
                    409,
                );
            }
            $seen[$deviceId] = true;

            $device = $devicesById->get($deviceId);
            if ($device === null) {
                throw ValidationException::withMessages([
                    "devicePlacements.{$index}.deviceId" => ['The selected Device is invalid.'],
                ]);
            }
            if ($device->home_laboratory_id !== $laboratoryId) {
                throw new LayoutDomainException(
                    'The Device home Laboratory does not match this Layout.',
                    'LAYOUT_DEVICE_HOME_MISMATCH',
                    409,
                );
            }
            if (! in_array($device->lifecycle_status, LayoutCatalog::ELIGIBLE_DEVICE_LIFECYCLES, true)) {
                throw new LayoutDomainException(
                    'The Device lifecycle is not eligible for Layout placement.',
                    'LAYOUT_DEVICE_NOT_ELIGIBLE',
                    409,
                );
            }
            if ($placement['role'] !== null
                && ! in_array($device->device_type, LayoutCatalog::STATION_DEVICE_TYPES, true)) {
                throw ValidationException::withMessages([
                    "devicePlacements.{$index}.role" => ['The selected role is valid only for a desktop PC or laptop.'],
                ]);
            }
        }
    }

    /** @param array<string, mixed> $data */
    private function validateGeometry(array $data): void
    {
        $rows = (int) $data['rows'];
        $columns = (int) $data['columns'];
        $children = count($data['structuralElements']) + count($data['devicePlacements']);
        if ($children > $rows * $columns) {
            throw ValidationException::withMessages([
                'structuralElements' => ['The aggregate has more footprints than available grid cells.'],
            ]);
        }

        $occupied = [];
        foreach ([
            'structuralElements' => $data['structuralElements'],
            'devicePlacements' => $data['devicePlacements'],
        ] as $collection => $items) {
            foreach ($items as $index => $item) {
                $lastRow = (int) $item['row'] + (int) $item['rowSpan'] - 1;
                $lastColumn = (int) $item['column'] + (int) $item['columnSpan'] - 1;
                if ($lastRow > $rows || $lastColumn > $columns) {
                    throw ValidationException::withMessages([
                        "{$collection}.{$index}" => ['The footprint must fit inside the Layout grid.'],
                    ]);
                }

                for ($row = (int) $item['row']; $row <= $lastRow; $row++) {
                    for ($column = (int) $item['column']; $column <= $lastColumn; $column++) {
                        $cell = "{$row}:{$column}";
                        if (isset($occupied[$cell])) {
                            throw new LayoutDomainException(
                                'Two Layout footprints occupy the same position.',
                                'LAYOUT_POSITION_OCCUPIED',
                                409,
                            );
                        }
                        $occupied[$cell] = true;
                    }
                }
            }
        }
    }

    private function optionalString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
