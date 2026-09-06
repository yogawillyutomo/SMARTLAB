<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Loan\LoanMutationService;
use App\Domain\Loan\LoanDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireLoanVersionPrecondition;
use App\Http\Requests\CreateLoanRequest;
use App\Http\Requests\EmptyLoanActionRequest;
use App\Http\Requests\ListLoansRequest;
use App\Http\Requests\LoanReasonRequest;
use App\Http\Requests\ReturnLoanRequest;
use App\Http\Resources\LoanResource;
use App\Models\Loan;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoanController extends Controller
{
    public function index(ListLoansRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $context = $this->context($request);
        $query = Loan::query()
            ->with('items')
            ->where('school_id', $context->membership->school_id);

        if (! $context->permissions->contains('loans.view-all')) {
            $query->where('requested_by_membership_id', $context->membership->id);
        }

        if (isset($validated['status'])) {
            $query->where('status', $validated['status']);
        }

        if ($request->has('overdue')) {
            if ($request->boolean('overdue')) {
                $query->where('status', 'checked_out')->where('requested_return_at', '<', now());
            } else {
                $query->where(function (Builder $query): void {
                    $query->where('status', '!=', 'checked_out')
                        ->orWhere('requested_return_at', '>=', now());
                });
            }
        }

        if (isset($validated['assetId'])) {
            $query->whereHas('items', fn (Builder $query) => $query->where('asset_id', $validated['assetId']));
        }

        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
            $query->where(function (Builder $query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['loan_number', 'borrower_name_snapshot', 'borrower_unit_snapshot', 'purpose'] as $index => $column) {
                    $query->whereRaw(
                        'LOWER(COALESCE('.$grammar->wrap($column).", '')) LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        $paginator = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => LoanResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateLoanRequest $request, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $loanId): JsonResponse
    {
        $context = $this->context($request);
        $query = Loan::query()
            ->with('items')
            ->where('school_id', $context->membership->school_id)
            ->whereKey($loanId);

        if (! $context->permissions->contains('loans.view-all')) {
            $query->where('requested_by_membership_id', $context->membership->id);
        }

        $loan = $query->first();
        if ($loan === null) {
            throw LoanDomainException::notFound();
        }

        return $this->loanResponse($loan, $request);
    }

    public function approve(EmptyLoanActionRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->approve($this->context($request), $this->actor($request), $loanId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function reject(LoanReasonRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->reject(
                $this->context($request),
                $this->actor($request),
                $loanId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function cancel(LoanReasonRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->cancel(
                $this->context($request),
                $this->actor($request),
                $loanId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function checkout(EmptyLoanActionRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->checkout($this->context($request), $this->actor($request), $loanId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function returnLoan(ReturnLoanRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        /** @var list<array{loanItemId:string,conditionReturn:string,returnNotes?:string|null}> $items */
        $items = $request->validated('items');

        return $this->loanResponse(
            $service->returnLoan(
                $this->context($request),
                $this->actor($request),
                $loanId,
                $this->expectedVersion($request),
                $items,
            ),
            $request,
        );
    }

    public function close(EmptyLoanActionRequest $request, string $loanId, LoanMutationService $service): JsonResponse
    {
        return $this->loanResponse(
            $service->close($this->context($request), $this->actor($request), $loanId, $this->expectedVersion($request)),
            $request,
        );
    }

    private function loanResponse(Loan $loan, Request $request, int $status = 200): JsonResponse
    {
        return (new LoanResource($loan))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$loan->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function actor(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireLoanVersionPrecondition::ATTRIBUTE);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
