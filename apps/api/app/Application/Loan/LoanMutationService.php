<?php

namespace App\Application\Loan;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Loan\LoanCatalog;
use App\Domain\Loan\LoanDomainException;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Loan;
use App\Models\LoanEvent;
use App\Models\LoanItem;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoanMutationService
{
    /** @param array<string, mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): Loan
    {
        return DB::transaction(function () use ($context, $actor, $data): Loan {
            $schoolId = (string) $context->membership->school_id;
            $assetIds = $this->canonicalAssetIds($data['assetIds']);
            $assets = $this->lockAssets($schoolId, $assetIds);
            $this->assertAssetLifecycleEligibility($assets);

            $id = (string) Str::ulid();
            $loan = new Loan([
                'school_id' => $schoolId,
                'loan_number' => $this->number($id),
                'borrower_reference' => $data['borrowerReference'] ?? null,
                'borrower_name_snapshot' => trim((string) $data['borrowerName']),
                'borrower_unit_snapshot' => $data['borrowerUnit'] ?? null,
                'purpose' => trim((string) $data['purpose']),
                'requested_return_at' => $data['requestedReturnAt'],
                'status' => 'submitted',
                'terminal_reason' => null,
                'requested_by_user_id' => $actor->id,
                'requested_by_membership_id' => $context->membership->id,
                'requested_by_user_id_snapshot' => $actor->id,
                'requested_by_membership_id_snapshot' => $context->membership->id,
                'requested_by_name_snapshot' => $actor->name,
                'version' => 1,
            ]);
            $loan->id = $id;
            $loan->save();

            foreach ($assets as $asset) {
                LoanItem::query()->create([
                    'school_id' => $schoolId,
                    'loan_id' => $loan->id,
                    'asset_id' => $asset->id,
                    'asset_code_snapshot' => $asset->asset_code,
                    'asset_name_snapshot' => $asset->name,
                    'condition_out' => null,
                    'condition_return' => null,
                    'return_notes' => null,
                    'custody_active' => false,
                ]);
            }

            $this->writeEvent($context, $actor, $loan, 'loan.submitted', null, 'submitted', [
                'assetIds' => $assetIds,
                'borrowerNameSnapshot' => $loan->borrower_name_snapshot,
                'requestedReturnAt' => $loan->requested_return_at->toISOString(),
            ]);

            return $this->reload($loan);
        });
    }

    public function approve(CurrentMembershipContext $context, User $actor, string $loanId, int $expectedVersion): Loan
    {
        return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion): Loan {
            $loan = $this->lockLoan($context, $loanId);
            $this->assertVersion($loan, $expectedVersion);
            $this->assertState($loan, ['submitted'], 'Only submitted Loans may be approved.');

            $assets = $this->lockLoanAssets($loan);
            $this->assertAssetsAvailableForCheckout($loan, $assets);

            $before = $loan->status;
            $loan->status = 'approved';
            $loan->approved_at = now();
            $this->stampAction($loan, 'approved', $context, $actor);
            $loan->version++;
            $loan->save();

            $this->writeEvent($context, $actor, $loan, 'loan.approved', $before, 'approved', [
                'assetIds' => $assets->pluck('id')->values()->all(),
            ]);

            return $this->reload($loan);
        });
    }

    public function reject(
        CurrentMembershipContext $context,
        User $actor,
        string $loanId,
        int $expectedVersion,
        string $reason,
    ): Loan {
        return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion, $reason): Loan {
            $loan = $this->lockLoan($context, $loanId);
            $this->assertVersion($loan, $expectedVersion);
            $this->assertState($loan, ['submitted'], 'Only submitted Loans may be rejected.');

            $before = $loan->status;
            $loan->status = 'rejected';
            $loan->terminal_reason = trim($reason);
            $loan->version++;
            $loan->save();

            $this->writeEvent($context, $actor, $loan, 'loan.rejected', $before, 'rejected', [
                'reason' => $loan->terminal_reason,
            ]);

            return $this->reload($loan);
        });
    }

    public function cancel(
        CurrentMembershipContext $context,
        User $actor,
        string $loanId,
        int $expectedVersion,
        string $reason,
    ): Loan {
        return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion, $reason): Loan {
            $loan = $this->lockLoan($context, $loanId);
            $this->assertVersion($loan, $expectedVersion);
            $this->assertCanCancel($context, $loan);
            $this->assertState($loan, ['submitted', 'approved'], 'Only submitted or approved Loans may be cancelled.');

            $before = $loan->status;
            $loan->status = 'cancelled';
            $loan->terminal_reason = trim($reason);
            $loan->version++;
            $loan->save();

            $this->writeEvent($context, $actor, $loan, 'loan.cancelled', $before, 'cancelled', [
                'reason' => $loan->terminal_reason,
            ]);

            return $this->reload($loan);
        });
    }

    public function checkout(CurrentMembershipContext $context, User $actor, string $loanId, int $expectedVersion): Loan
    {
        try {
            return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion): Loan {
                $loan = $this->lockLoan($context, $loanId);
                $this->assertVersion($loan, $expectedVersion);
                $this->assertState($loan, ['approved'], 'Only approved Loans may be checked out.');

                $assets = $this->lockLoanAssets($loan);
                $this->assertAssetsAvailableForCheckout($loan, $assets);
                $assetsById = $assets->keyBy('id');

                $items = LoanItem::query()
                    ->where('loan_id', $loan->id)
                    ->orderBy('asset_id')
                    ->lockForUpdate()
                    ->get();

                foreach ($items as $item) {
                    $asset = $assetsById->get($item->asset_id);
                    if (! $asset instanceof Asset) {
                        throw LoanDomainException::stateConflict('Loan Asset identity changed unexpectedly.');
                    }

                    $item->condition_out = $asset->condition;
                    $item->condition_return = null;
                    $item->return_notes = null;
                    $item->custody_active = true;
                    $item->save();
                }

                $before = $loan->status;
                $loan->status = 'checked_out';
                $loan->handed_over_at = now();
                $this->stampAction($loan, 'handed_over', $context, $actor);
                $loan->version++;
                $loan->save();

                $this->writeEvent($context, $actor, $loan, 'loan.checked_out', $before, 'checked_out', [
                    'items' => $items->map(fn (LoanItem $item): array => [
                        'loanItemId' => (string) $item->id,
                        'assetId' => (string) $item->asset_id,
                        'conditionOut' => (string) $item->condition_out,
                    ])->all(),
                ]);

                return $this->reload($loan);
            });
        } catch (UniqueConstraintViolationException $exception) {
            throw new LoanDomainException(
                'One or more Assets are already under active Loan custody.',
                'LOAN_ASSET_UNAVAILABLE',
                409,
            );
        }
    }

    /**
     * @param list<array{loanItemId:string,conditionReturn:string,returnNotes?:string|null}> $returnItems
     */
    public function returnLoan(
        CurrentMembershipContext $context,
        User $actor,
        string $loanId,
        int $expectedVersion,
        array $returnItems,
    ): Loan {
        return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion, $returnItems): Loan {
            $loan = $this->lockLoan($context, $loanId);
            $this->assertVersion($loan, $expectedVersion);
            $this->assertState($loan, ['checked_out'], 'Only checked-out Loans may be returned.');

            $this->lockLoanAssets($loan);

            $items = LoanItem::query()
                ->where('loan_id', $loan->id)
                ->orderBy('asset_id')
                ->lockForUpdate()
                ->get();

            $byId = collect($returnItems)->keyBy('loanItemId');
            if ($items->count() !== $byId->count()
                || $items->contains(fn (LoanItem $item): bool => ! $byId->has((string) $item->id))) {
                throw ValidationException::withMessages([
                    'items' => ['Return evidence must cover every LoanItem exactly once.'],
                ]);
            }

            $evidence = [];
            foreach ($items as $item) {
                $input = $byId->get((string) $item->id);
                if (! is_array($input)) {
                    throw ValidationException::withMessages(['items' => ['Invalid return evidence.']]);
                }

                $item->condition_return = (string) $input['conditionReturn'];
                $item->return_notes = $this->nullableTrim($input['returnNotes'] ?? null);
                $item->custody_active = false;
                $item->save();

                $evidence[] = [
                    'loanItemId' => (string) $item->id,
                    'assetId' => (string) $item->asset_id,
                    'conditionOut' => $item->condition_out,
                    'conditionReturn' => $item->condition_return,
                    'returnNotes' => $item->return_notes,
                ];
            }

            $before = $loan->status;
            $loan->status = 'returned';
            $loan->returned_at = now();
            $this->stampAction($loan, 'returned', $context, $actor);
            $loan->version++;
            $loan->save();

            $this->writeEvent($context, $actor, $loan, 'loan.returned', $before, 'returned', [
                'items' => $evidence,
            ]);

            return $this->reload($loan);
        });
    }

    public function close(CurrentMembershipContext $context, User $actor, string $loanId, int $expectedVersion): Loan
    {
        return DB::transaction(function () use ($context, $actor, $loanId, $expectedVersion): Loan {
            $loan = $this->lockLoan($context, $loanId);
            $this->assertVersion($loan, $expectedVersion);
            $this->assertState($loan, ['returned'], 'Only returned Loans may be closed.');

            $before = $loan->status;
            $loan->status = 'closed';
            $loan->inspected_at = now();
            $this->stampAction($loan, 'inspected', $context, $actor);
            $loan->version++;
            $loan->save();

            $this->writeEvent($context, $actor, $loan, 'loan.closed', $before, 'closed', []);

            return $this->reload($loan);
        });
    }

    private function lockLoan(CurrentMembershipContext $context, string $loanId): Loan
    {
        $loan = Loan::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($loanId)
            ->lockForUpdate()
            ->first();

        if ($loan === null) {
            throw LoanDomainException::notFound();
        }

        return $loan;
    }

    private function assertVersion(Loan $loan, int $expectedVersion): void
    {
        if ($loan->version !== $expectedVersion) {
            throw new LoanDomainException(
                'Loan has changed since it was loaded.',
                'LOAN_VERSION_CONFLICT',
                412,
            );
        }
    }

    /** @param list<string> $states */
    private function assertState(Loan $loan, array $states, string $message): void
    {
        if (! in_array($loan->status, $states, true)) {
            throw LoanDomainException::stateConflict($message);
        }
    }

    private function assertCanCancel(CurrentMembershipContext $context, Loan $loan): void
    {
        if ($context->permissions->contains('loans.view-all')) {
            return;
        }

        if ((string) $loan->requested_by_membership_id !== (string) $context->membership->id) {
            throw LoanDomainException::notFound();
        }
    }

    /** @param list<string> $assetIds @return Collection<int, Asset> */
    private function lockAssets(string $schoolId, array $assetIds): Collection
    {
        $assets = Asset::query()
            ->where('school_id', $schoolId)
            ->whereIn('id', $assetIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        if ($assets->count() !== count($assetIds)) {
            throw ValidationException::withMessages([
                'assetIds' => ['One or more selected Assets are invalid.'],
            ]);
        }

        return $assets;
    }

    /** @return Collection<int, Asset> */
    private function lockLoanAssets(Loan $loan): Collection
    {
        $assetIds = LoanItem::query()
            ->where('loan_id', $loan->id)
            ->orderBy('asset_id')
            ->pluck('asset_id')
            ->map(fn ($id): string => (string) $id)
            ->all();

        return $this->lockAssets((string) $loan->school_id, $assetIds);
    }

    /** @param Collection<int, Asset> $assets */
    private function assertAssetLifecycleEligibility(Collection $assets): void
    {
        foreach ($assets as $asset) {
            if ($asset->lifecycle_status !== 'active'
                || ! in_array($asset->condition, LoanCatalog::ASSET_LOANABLE_CONDITIONS, true)) {
                throw new LoanDomainException(
                    'One or more Assets are not eligible for Loan custody.',
                    'LOAN_ASSET_INELIGIBLE',
                    409,
                );
            }
        }

        $deviceIds = $assets
            ->pluck('linked_device_id')
            ->filter()
            ->map(fn ($id): string => (string) $id)
            ->unique()
            ->sort()
            ->values()
            ->all();

        if ($deviceIds === []) {
            return;
        }

        $schoolIds = $assets->pluck('school_id')->map(fn ($id): string => (string) $id)->unique()->values();
        if ($schoolIds->count() !== 1) {
            throw new LoanDomainException(
                'Loan Asset tenant evidence is inconsistent.',
                'LOAN_ASSET_INELIGIBLE',
                409,
            );
        }

        $devices = Device::query()
            ->where('school_id', $schoolIds->first())
            ->whereIn('id', $deviceIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        foreach ($deviceIds as $deviceId) {
            $device = $devices->get($deviceId);
            if (! $device instanceof Device
                || ! in_array($device->lifecycle_status, LoanCatalog::DEVICE_LOANABLE_LIFECYCLES, true)) {
                throw new LoanDomainException(
                    'A linked Device lifecycle prohibits Loan custody.',
                    'LOAN_DEVICE_INELIGIBLE',
                    409,
                );
            }
        }
    }

    /** @param Collection<int, Asset> $assets */
    private function assertAssetsAvailableForCheckout(Loan $loan, Collection $assets): void
    {
        $this->assertAssetLifecycleEligibility($assets);

        $assetIds = $assets->pluck('id')->map(fn ($id): string => (string) $id)->all();
        $conflict = LoanItem::query()
            ->whereIn('asset_id', $assetIds)
            ->where('custody_active', true)
            ->where('loan_id', '!=', $loan->id)
            ->exists();

        if ($conflict) {
            throw new LoanDomainException(
                'One or more Assets are already under active Loan custody.',
                'LOAN_ASSET_UNAVAILABLE',
                409,
            );
        }

        // S4.5 introduces MaintenanceExecution authority. There is no Maintenance
        // custody row to query before that tranche exists; S4.5 must add the
        // symmetric Loan↔Maintenance exclusion under the same Asset lock order.
    }

    /** @param array<mixed> $assetIds @return list<string> */
    private function canonicalAssetIds(array $assetIds): array
    {
        $ids = array_map(fn ($id): string => (string) $id, $assetIds);
        sort($ids, SORT_STRING);

        return $ids;
    }

    private function stampAction(
        Loan $loan,
        string $action,
        CurrentMembershipContext $context,
        User $actor,
    ): void {
        $loan->{$action.'_by_user_id'} = $actor->id;
        $loan->{$action.'_by_membership_id'} = $context->membership->id;
        $loan->{$action.'_by_user_id_snapshot'} = $actor->id;
        $loan->{$action.'_by_membership_id_snapshot'} = $context->membership->id;
        $loan->{$action.'_by_name_snapshot'} = $actor->name;
    }

    /** @param array<string, mixed> $payload */
    private function writeEvent(
        CurrentMembershipContext $context,
        User $actor,
        Loan $loan,
        string $eventType,
        ?string $beforeStatus,
        string $afterStatus,
        array $payload,
    ): void {
        LoanEvent::query()->create([
            'school_id' => $loan->school_id,
            'loan_id' => $loan->id,
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

    private function reload(Loan $loan): Loan
    {
        return $loan->refresh()->load('items');
    }

    private function number(string $id): string
    {
        return 'LOAN-'.now()->format('Ymd').'-'.strtoupper(substr($id, -8));
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
