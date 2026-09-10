<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssetQrLabelBatchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'templateKey' => $this->template_key,
            'filters' => $this->filters,
            'assetCount' => $this->asset_count,
            'laboratory' => $this->laboratory_id === null ? null : [
                'id' => $this->laboratory_id,
                'code' => $this->laboratory_code_snapshot,
                'name' => $this->laboratory_name_snapshot,
            ],
            'generatedByName' => $this->generated_by_name_snapshot,
            'generatedAt' => $this->generated_at?->toISOString(),
            'items' => $this->when($this->relationLoaded('items'), function (): array {
                return $this->items
                    ->sortBy('ordinal')
                    ->map(fn ($item): array => [
                        'ordinal' => $item->ordinal,
                        'assetId' => $item->asset_id,
                        'assetCode' => $item->asset_code_snapshot,
                        'assetName' => $item->asset_name_snapshot,
                        'laboratory' => $item->laboratory_id_snapshot === null ? null : [
                            'id' => $item->laboratory_id_snapshot,
                            'code' => $item->laboratory_code_snapshot,
                            'name' => $item->laboratory_name_snapshot,
                        ],
                        'publicId' => $item->public_id_snapshot,
                        'tokenVersion' => $item->token_version_snapshot,
                        'scanPath' => '/api/v1/public/assets/qr/'.$item->public_id_snapshot,
                    ])
                    ->values()
                    ->all();
            }),
            'events' => $this->when($this->relationLoaded('events'), function (): array {
                return $this->events
                    ->sortBy(fn ($event): string => $event->created_at?->format('YmdHis.u').'-'.$event->id)
                    ->map(fn ($event): array => [
                        'type' => $event->event_type,
                        'actorName' => $event->actor_name_snapshot,
                        'payload' => $event->payload,
                        'createdAt' => $event->created_at?->toISOString(),
                    ])
                    ->values()
                    ->all();
            }),
        ];
    }
}
