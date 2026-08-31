<?php

namespace App\Application\Incident;

final class IncidentSubjectLockPlan
{
    /**
     * @return array{laboratoryIds: list<string>, deviceIds: list<string>}
     */
    public function build(
        string $currentLaboratoryId,
        string $finalLaboratoryId,
        ?string $currentDeviceId,
        ?string $finalDeviceId,
    ): array {
        $laboratoryIds = array_values(array_unique([$currentLaboratoryId, $finalLaboratoryId]));
        sort($laboratoryIds, SORT_STRING);

        $deviceIds = array_values(array_unique(array_filter(
            [$currentDeviceId, $finalDeviceId],
            static fn (?string $id): bool => $id !== null,
        )));
        sort($deviceIds, SORT_STRING);

        return ['laboratoryIds' => $laboratoryIds, 'deviceIds' => $deviceIds];
    }
}
