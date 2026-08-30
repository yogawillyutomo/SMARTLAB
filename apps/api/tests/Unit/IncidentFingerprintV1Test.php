<?php

namespace Tests\Unit;

use App\Domain\Incident\Fingerprint\IncidentFingerprint;
use App\Domain\Incident\Fingerprint\IncidentFingerprintRegistry;
use App\Domain\Incident\Fingerprint\IncidentFingerprintV1;
use Illuminate\Support\Str;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class IncidentFingerprintV1Test extends TestCase
{
    public function test_canonical_json_has_the_exact_locked_order_and_defaults(): void
    {
        $fingerprint = new IncidentFingerprintV1;
        $payload = $this->payload();
        unset($payload['priority'], $payload['blocksLaboratoryOperation']);

        $this->assertSame(
            '{"laboratoryId":"'.$payload['laboratoryId'].'","deviceId":null,"category":"hardware","priority":"normal","title":"Desktop gagal menyala","description":"Desktop berhenti sebelum sistem operasi dimuat.","impact":null,"blocksLaboratoryOperation":false,"stepsTaken":null,"occurredAt":"2026-08-29T03:00:00.000000Z"}',
            $fingerprint->canonicalJson($payload),
        );
        $this->assertSame(64, strlen($fingerprint->fingerprint($payload)));
        $this->assertSame(strtolower($fingerprint->fingerprint($payload)), $fingerprint->fingerprint($payload));
    }

    public function test_reordered_keys_omitted_defaults_timezone_and_nullable_blanks_are_equivalent(): void
    {
        $fingerprint = new IncidentFingerprintV1;
        $base = $this->payload();
        $implicit = $base;
        unset($implicit['priority'], $implicit['blocksLaboratoryOperation']);
        $implicit['deviceId'] = ' ';
        $implicit['impact'] = '';
        $implicit['stepsTaken'] = "  \t";

        $explicit = array_reverse($base, true);
        $explicit['priority'] = ' NORMAL ';
        $explicit['blocksLaboratoryOperation'] = false;
        $explicit['occurredAt'] = '2026-08-29T10:00:00+07:00';

        $this->assertSame($fingerprint->fingerprint($implicit), $fingerprint->fingerprint($explicit));
    }

    public function test_nfc_equivalent_strings_have_the_same_fingerprint(): void
    {
        $fingerprint = new IncidentFingerprintV1;
        $base = $this->payload();
        $composed = array_replace($base, ['title' => "Monitor kafe\u{00E9} mati"]);
        $decomposed = array_replace($base, ['title' => "Monitor kafee\u{0301} mati"]);

        $this->assertSame($fingerprint->fingerprint($composed), $fingerprint->fingerprint($decomposed));
    }

    #[DataProvider('materialChanges')]
    public function test_every_material_business_field_changes_the_fingerprint(string $field, mixed $value): void
    {
        $fingerprint = new IncidentFingerprintV1;
        $baseline = $this->payload();
        $changed = $baseline;
        $changed[$field] = $value;

        $this->assertNotSame($fingerprint->fingerprint($baseline), $fingerprint->fingerprint($changed));
    }

    public static function materialChanges(): array
    {
        return [
            ['laboratoryId', strtolower((string) Str::ulid())],
            ['deviceId', strtolower((string) Str::ulid())],
            ['category', 'software'],
            ['priority', 'high'],
            ['title', 'Desktop gagal melakukan boot'],
            ['description', 'Desktop menampilkan pesan galat saat sistem operasi dimuat.'],
            ['impact', 'Satu meja praktikum tidak dapat digunakan.'],
            ['blocksLaboratoryOperation', true],
            ['stepsTaken', 'Kabel daya sudah diperiksa.'],
            ['occurredAt', '2026-08-29T03:00:01Z'],
        ];
    }

    public function test_registry_dispatches_persisted_versions_without_assuming_only_v1(): void
    {
        $v2 = new class implements IncidentFingerprint
        {
            public function version(): int
            {
                return 2;
            }

            public function fingerprint(array $payload): string
            {
                return str_repeat('a', 64);
            }

            public function canonicalize(array $payload): array
            {
                return $payload;
            }

            public function canonicalJson(array $payload): string
            {
                return '{}';
            }
        };
        $registry = new IncidentFingerprintRegistry([new IncidentFingerprintV1, $v2]);

        $this->assertSame([1, 2], $registry->supportedVersions());
        $this->assertSame(2, $registry->current()->version());
        $this->assertSame(1, $registry->forVersion(1)->version());
    }

    public function test_invalid_ulid_and_non_boolean_are_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentFingerprintV1)->fingerprint($this->payload([
            'laboratoryId' => 'not-an-ulid',
            'blocksLaboratoryOperation' => 1,
        ]));
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return array_replace([
            'laboratoryId' => strtolower((string) Str::ulid()),
            'deviceId' => null,
            'category' => 'hardware',
            'priority' => 'normal',
            'title' => 'Desktop gagal menyala',
            'description' => 'Desktop berhenti sebelum sistem operasi dimuat.',
            'impact' => null,
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => null,
            'occurredAt' => '2026-08-29T03:00:00Z',
        ], $overrides);
    }
}
