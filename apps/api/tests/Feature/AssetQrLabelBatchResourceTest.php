<?php

namespace Tests\Feature;

use App\Http\Resources\AssetQrLabelBatchResource;
use App\Models\AssetQrLabelBatch;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Tests\TestCase;

class AssetQrLabelBatchResourceTest extends TestCase
{
    public function test_empty_filter_snapshot_is_projected_as_json_object(): void
    {
        $batch = new AssetQrLabelBatch([
            'template_key' => '50x30',
            'filters' => [],
            'asset_count' => 1,
            'generated_by_name_snapshot' => 'Operator',
            'generated_at' => now(),
        ]);
        $batch->id = (string) Str::ulid();
        $batch->laboratory_id = null;

        $payload = (new AssetQrLabelBatchResource($batch))->resolve(Request::create('/', 'GET'));

        $this->assertIsObject($payload['filters']);
        $this->assertSame([], get_object_vars($payload['filters']));
    }
}
