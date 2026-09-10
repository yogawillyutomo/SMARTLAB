<?php

namespace App\Application\Maintenance;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Maintenance\MaintenanceDomainException;
use App\Models\Asset;
use App\Models\Laboratory;
use App\Models\MaintenanceCampaign;
use App\Models\MaintenanceCampaignEvent;
use App\Models\MaintenanceCampaignItem;
use App\Models\MaintenanceExecution;
use App\Models\MaintenancePlan;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class MaintenanceCampaignService
{
    public function __construct(
        private readonly MaintenanceMutationService $maintenanceService,
    ) {
    }

    /**
     * @param array{
     *   laboratoryId:string,
     *   name:string,
     *   description?:string|null,
     *   frequencyKind:string,
     *   intervalDays?:int|null,
     *   checklistTemplate:list<string>,
     *   assignedTechnicianReference?:string|null,
     *   assignedTechnicianName?:string|null,
     *   nextDueDate:string,
     *   assetIds:list<string>
     * } $data
     */
    public function create(CurrentMembershipContext $context, User $actor, array $data): MaintenanceCampaign
    {
        return DB::transaction(function () use ($context, $actor, $data): MaintenanceCampaign {
            $laboratory = Laboratory::query()
                ->where('school_id', $context->membership->school_id)
                ->whereKey((string) $data['laboratoryId'])
                ->lockForUpdate()
                ->first();

            if ($laboratory === null || $laboratory->status !== 'active') {
                throw ValidationException::withMessages([
                    'laboratoryId' => ['An active Laboratory in the current School is required.'],
                ]);
            }

            $assetIds = array_values(array_unique(array_map('strval', $data['assetIds'])));
            sort($assetIds, SORT_STRING);

            $assets = Asset::query()
                ->where('school_id', $context->membership->school_id)
                ->whereIn('id', $assetIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy(fn (Asset $asset): string => (string) $asset->id);

            if ($assets->count() !== count($assetIds)) {
                throw ValidationException::withMessages([
                    'assetIds' => ['Every selected Asset must exist in the current School.'],
                ]);
            }

            foreach ($assetIds as $assetId) {
                /** @var Asset $asset */
                $asset = $assets->get($assetId);
                if ((string) $asset->home_laboratory_id !== (string) $laboratory->id) {
                    throw ValidationException::withMessages([
                        'assetIds' => ['Every selected Asset must belong to the selected Laboratory.'],
                    ]);
                }
            }

            $id = (string) Str::ulid();
            $campaign = new MaintenanceCampaign([
                'school_id' => $context->membership->school_id,
                'campaign_code' => $this->campaignCode($id),
                'laboratory_id' => $laboratory->id,
                'laboratory_code_snapshot' => $laboratory->code,
                'laboratory_name_snapshot' => $laboratory->name,
                'name' => trim((string) $data['name']),
                'description' => $this->nullableTrim($data['description'] ?? null),
                'frequency_kind' => (string) $data['frequencyKind'],
                'interval_days' => ($data['frequencyKind'] ?? null) === 'custom_interval'
                    ? (int) $data['intervalDays']
                    : null,
                'checklist_template' => array_values(array_map(
                    fn ($item): string => trim((string) $item),
                    $data['checklistTemplate'],
                )),
                'assigned_technician_reference' => $this->nullableTrim($data['assignedTechnicianReference'] ?? null),
                'assigned_technician_name_snapshot' => $this->nullableTrim($data['assignedTechnicianName'] ?? null),
                'next_due_date' => $data['nextDueDate'],
                'status' => 'active',
                'version' => 1,
            ]);
            $campaign->id = $id;
            $campaign->save();

            $itemIds = [];
            $planIds = [];

            foreach ($assetIds as $assetId) {
                /** @var Asset $asset */
                $asset = $assets->get($assetId);
                $plan = $this->maintenanceService->createPlan($context, $actor, [
                    'assetId' => (string) $asset->id,
                    'name' => mb_substr($campaign->name.' · '.$asset->asset_code, 0, 255),
                    'frequencyKind' => $campaign->frequency_kind,
                    'intervalDays' => $campaign->interval_days,
                    'checklistTemplate' => $campaign->checklist_template,
                    'assignedTechnicianReference' => $campaign->assigned_technician_reference,
                    'assignedTechnicianName' => $campaign->assigned_technician_name_snapshot,
                    'nextDueDate' => $campaign->next_due_date->toDateString(),
                ]);

                $item = MaintenanceCampaignItem::query()->create([
                    'school_id' => $campaign->school_id,
                    'maintenance_campaign_id' => $campaign->id,
                    'asset_id' => $asset->id,
                    'asset_code_snapshot' => $asset->asset_code,
                    'asset_name_snapshot' => $asset->name,
                    'maintenance_plan_id' => $plan->id,
                    'plan_code_snapshot' => $plan->plan_code,
                    'created_at' => now(),
                ]);

                $itemIds[] = (string) $item->id;
                $planIds[] = (string) $plan->id;
            }

            $this->writeEvent($context, $actor, $campaign, 'maintenance_campaign.created', null, 'active', [
                'laboratoryId' => (string) $laboratory->id,
                'assetIds' => $assetIds,
                'itemIds' => $itemIds,
                'maintenancePlanIds' => $planIds,
                'assetCount' => count($assetIds),
            ]);

            return $this->reload($campaign);
        });
    }

    public function activate(
        CurrentMembershipContext $context,
        User $actor,
        string $campaignId,
        int $expectedVersion,
    ): MaintenanceCampaign {
        return $this->setStatus($context, $actor, $campaignId, $expectedVersion, 'active');
    }

    public function deactivate(
        CurrentMembershipContext $context,
        User $actor,
        string $campaignId,
        int $expectedVersion,
    ): MaintenanceCampaign {
        return $this->setStatus($context, $actor, $campaignId, $expectedVersion, 'inactive');
    }

    /**
     * @param array{
     *   scheduledFor:string,
     *   technicianReference?:string|null,
     *   technicianName:string,
     *   assetIds?:list<string>
     * } $data
     * @return array{campaign:MaintenanceCampaign,executions:list<MaintenanceExecution>}
     */
    public function scheduleBatch(
        CurrentMembershipContext $context,
        User $actor,
        string $campaignId,
        int $expectedVersion,
        array $data,
    ): array {
        return DB::transaction(function () use ($context, $actor, $campaignId, $expectedVersion, $data): array {
            $campaign = $this->lockCampaign($context, $campaignId);
            $this->assertVersion($campaign, $expectedVersion);

            if ($campaign->status !== 'active') {
                throw MaintenanceDomainException::stateConflict('Only active MaintenanceCampaigns may batch-schedule executions.');
            }

            $selectedAssetIds = isset($data['assetIds'])
                ? array_values(array_unique(array_map('strval', $data['assetIds'])))
                : null;

            if ($selectedAssetIds !== null) {
                sort($selectedAssetIds, SORT_STRING);
            }

            $itemsQuery = MaintenanceCampaignItem::query()
                ->where('school_id', $context->membership->school_id)
                ->where('maintenance_campaign_id', $campaign->id);

            if ($selectedAssetIds !== null) {
                $itemsQuery->whereIn('asset_id', $selectedAssetIds);
            }

            $items = $itemsQuery->orderBy('asset_id')->lockForUpdate()->get();

            if ($selectedAssetIds !== null && $items->count() !== count($selectedAssetIds)) {
                throw ValidationException::withMessages([
                    'assetIds' => ['Every selected Asset must belong to the MaintenanceCampaign.'],
                ]);
            }

            if ($items->isEmpty()) {
                throw ValidationException::withMessages([
                    'assetIds' => ['The MaintenanceCampaign has no eligible selected Asset.'],
                ]);
            }

            $executions = [];
            foreach ($items as $item) {
                $plan = MaintenancePlan::query()
                    ->where('school_id', $context->membership->school_id)
                    ->whereKey($item->maintenance_plan_id)
                    ->lockForUpdate()
                    ->first();

                if ($plan === null) {
                    throw MaintenanceDomainException::planNotFound();
                }

                $executions[] = $this->maintenanceService->scheduleExecution(
                    $context,
                    $actor,
                    (string) $plan->id,
                    (int) $plan->version,
                    [
                        'scheduledFor' => $data['scheduledFor'],
                        'technicianReference' => $this->nullableTrim($data['technicianReference'] ?? $campaign->assigned_technician_reference),
                        'technicianName' => trim((string) $data['technicianName']),
                    ],
                );
            }

            $campaign->version++;
            $campaign->save();

            $this->writeEvent($context, $actor, $campaign, 'maintenance_campaign.batch_scheduled', 'active', 'active', [
                'scheduledFor' => (string) $data['scheduledFor'],
                'assetIds' => array_map(fn (MaintenanceExecution $execution): string => (string) $execution->asset_id, $executions),
                'maintenanceExecutionIds' => array_map(fn (MaintenanceExecution $execution): string => (string) $execution->id, $executions),
                'executionCount' => count($executions),
            ]);

            return [
                'campaign' => $this->reload($campaign),
                'executions' => $executions,
            ];
        });
    }

    private function setStatus(
        CurrentMembershipContext $context,
        User $actor,
        string $campaignId,
        int $expectedVersion,
        string $targetStatus,
    ): MaintenanceCampaign {
        return DB::transaction(function () use ($context, $actor, $campaignId, $expectedVersion, $targetStatus): MaintenanceCampaign {
            $campaign = $this->lockCampaign($context, $campaignId);
            $this->assertVersion($campaign, $expectedVersion);

            if ($campaign->status === $targetStatus) {
                return $this->reload($campaign);
            }

            $before = $campaign->status;
            $campaign->status = $targetStatus;
            $campaign->version++;
            $campaign->save();

            $this->writeEvent(
                $context,
                $actor,
                $campaign,
                $targetStatus === 'active' ? 'maintenance_campaign.activated' : 'maintenance_campaign.deactivated',
                $before,
                $targetStatus,
                [],
            );

            return $this->reload($campaign);
        });
    }

    private function lockCampaign(CurrentMembershipContext $context, string $campaignId): MaintenanceCampaign
    {
        $campaign = MaintenanceCampaign::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($campaignId)
            ->lockForUpdate()
            ->first();

        if ($campaign === null) {
            throw MaintenanceDomainException::campaignNotFound();
        }

        return $campaign;
    }

    private function assertVersion(MaintenanceCampaign $campaign, int $expectedVersion): void
    {
        if ($campaign->version !== $expectedVersion) {
            throw MaintenanceDomainException::campaignVersionConflict();
        }
    }

    private function reload(MaintenanceCampaign $campaign): MaintenanceCampaign
    {
        return $campaign->refresh()->load(['items' => fn ($query) => $query->orderBy('asset_code_snapshot')]);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function writeEvent(
        CurrentMembershipContext $context,
        User $actor,
        MaintenanceCampaign $campaign,
        string $eventType,
        ?string $beforeStatus,
        ?string $afterStatus,
        array $payload,
    ): void {
        MaintenanceCampaignEvent::query()->create([
            'school_id' => $campaign->school_id,
            'maintenance_campaign_id' => $campaign->id,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'before_status' => $beforeStatus,
            'after_status' => $afterStatus,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }

    private function campaignCode(string $id): string
    {
        return 'MC-'.now()->format('Ymd').'-'.strtoupper(substr($id, -8));
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
