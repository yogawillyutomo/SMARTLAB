<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Inventory\InventoryMutationService;
use App\Domain\Inventory\InventoryDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireInventoryItemVersionPrecondition;
use App\Http\Requests\CreateInventoryItemRequest;
use App\Http\Requests\CreateInventoryTransactionRequest;
use App\Http\Requests\ListInventoryItemsRequest;
use App\Http\Requests\ListInventoryTransactionsRequest;
use App\Http\Requests\UpdateInventoryItemRequest;
use App\Http\Resources\InventoryItemResource;
use App\Http\Resources\InventoryTransactionResource;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InventoryController extends Controller
{
    public function index(ListInventoryItemsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = InventoryItem::query()
            ->where('school_id', $this->context($request)->membership->school_id);

        if (isset($validated['category'])) {
            $query->where('category', $validated['category']);
        }

        if (($validated['lowStock'] ?? false) === true) {
            $query->whereColumn('on_hand_quantity', '<=', 'minimum_stock');
        }

        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
            $query->where(function (Builder $query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['item_code', 'name', 'category', 'storage_location', 'supplier_name'] as $index => $column) {
                    $query->whereRaw(
                        'LOWER(COALESCE('.$grammar->wrap($column).", '')) LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        $paginator = $query
            ->orderBy('item_code')
            ->orderBy('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => InventoryItemResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateInventoryItemRequest $request, InventoryMutationService $service): JsonResponse
    {
        return $this->itemResponse(
            $service->createItem($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $itemId): JsonResponse
    {
        $item = InventoryItem::query()
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($itemId)
            ->first();

        if ($item === null) {
            throw new InventoryDomainException('Inventory item not found.', 'STOCK_ITEM_NOT_FOUND', 404);
        }

        return $this->itemResponse($item, $request);
    }

    public function update(
        UpdateInventoryItemRequest $request,
        string $itemId,
        InventoryMutationService $service,
    ): JsonResponse {
        return $this->itemResponse(
            $service->updateItem(
                $this->context($request),
                $this->actor($request),
                $itemId,
                (int) $request->attributes->get(RequireInventoryItemVersionPrecondition::ATTRIBUTE),
                $request->validated(),
            ),
            $request,
        );
    }

    public function transactions(ListInventoryTransactionsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = InventoryTransaction::query()
            ->where('school_id', $this->context($request)->membership->school_id);

        if (isset($validated['inventoryItemId'])) {
            $query->where('inventory_item_id', $validated['inventoryItemId']);
        }
        if (isset($validated['kind'])) {
            $query->where('kind', $validated['kind']);
        }
        if (isset($validated['from'])) {
            $query->where('occurred_at', '>=', $validated['from'].' 00:00:00');
        }
        if (isset($validated['to'])) {
            $query->where('occurred_at', '<=', $validated['to'].' 23:59:59.999999');
        }

        $paginator = $query
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->paginate((int) ($validated['perPage'] ?? 50), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => InventoryTransactionResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function transact(
        CreateInventoryTransactionRequest $request,
        InventoryMutationService $service,
    ): JsonResponse {
        $result = $service->transact(
            $this->context($request),
            $this->actor($request),
            $request->validated(),
        );

        return response()->json([
            'data' => (new InventoryTransactionResource($result['transaction']))->resolve($request),
            'meta' => ['replayed' => $result['replayed']],
        ], $result['replayed'] ? 200 : 201);
    }

    private function itemResponse(InventoryItem $item, Request $request, int $status = 200): JsonResponse
    {
        return (new InventoryItemResource($item))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$item->version.'"');
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

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
