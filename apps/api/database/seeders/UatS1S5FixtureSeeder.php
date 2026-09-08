<?php

namespace Database\Seeders;

use App\Application\Asset\AssetMutationService;
use App\Application\Device\DeviceMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Application\Inventory\InventoryMutationService;
use App\Models\AcademicClass;
use App\Models\AcademicUnit;
use App\Models\AcademicYear;
use App\Models\Asset;
use App\Models\Device;
use App\Models\InventoryItem;
use App\Models\Laboratory;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\Role;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class UatS1S5FixtureSeeder extends Seeder
{
    private const PASSWORD_ENV = 'SMARTLAB_UAT_FIXTURE_PASSWORD';

    private const MIN_PASSWORD_LENGTH = 12;

    /** @var array<string, array{name:string,role:string,nip?:string,nis?:string}> */
    public const ACCOUNTS = [
        'uat.labadmin@smartlab.local' => [
            'name' => 'Admin Lab UAT',
            'role' => 'admin-lab',
            'nip' => 'UAT-LABADMIN',
        ],
        'uat.kalab@smartlab.local' => [
            'name' => 'Kepala Lab UAT',
            'role' => 'kepala-lab',
            'nip' => 'UAT-KALAB',
        ],
        'uat.technician@smartlab.local' => [
            'name' => 'Teknisi UAT',
            'role' => 'teknisi',
            'nip' => 'UAT-TECH',
        ],
        'uat.teacher@smartlab.local' => [
            'name' => 'Guru UAT',
            'role' => 'guru',
            'nip' => 'UAT-GURU',
        ],
        'uat.student@smartlab.local' => [
            'name' => 'Siswa UAT',
            'role' => 'siswa',
            'nis' => 'UAT-SISWA',
        ],
    ];

    public function __construct(
        private readonly DeviceMutationService $deviceService,
        private readonly AssetMutationService $assetService,
        private readonly InventoryMutationService $inventoryService,
    ) {
    }

    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new RuntimeException(
                'UatS1S5FixtureSeeder hanya boleh dijalankan pada environment local/testing.',
            );
        }

        $password = getenv(self::PASSWORD_ENV);
        if (! is_string($password) || mb_strlen($password) < self::MIN_PASSWORD_LENGTH) {
            throw new RuntimeException(
                self::PASSWORD_ENV.' wajib diisi dengan password minimal '.self::MIN_PASSWORD_LENGTH.' karakter.',
            );
        }

        $this->call([
            RoleSeeder::class,
            PermissionSeeder::class,
            RolePermissionSeeder::class,
        ]);

        $adminMembership = SchoolMembership::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($query) => $query
                ->where('email', UatAdminSeeder::EMAIL)
                ->where('status', 'active'))
            ->whereHas('roles', fn ($query) => $query->where('key', 'super-admin'))
            ->with(['user', 'roles.permissions'])
            ->sole();

        $school = $adminMembership->school;
        if ($school === null || $school->status !== 'active') {
            throw new RuntimeException('School UAT admin harus berstatus active.');
        }

        $context = new CurrentMembershipContext(
            $adminMembership,
            $adminMembership->effectivePermissions()->pluck('key')->values(),
        );
        $actor = $adminMembership->user;

        DB::transaction(function () use ($password, $school, $context, $actor): void {
            $memberships = $this->seedAccounts((string) $school->id, $password);

            $labs = $this->seedLaboratories((string) $school->id);
            $devices = $this->seedDevices($context, $labs);
            $assets = $this->seedAssets($context, $labs, $devices);

            $this->seedInventory($context, $actor);
            $this->seedAcademicReference(
                (string) $school->id,
                $memberships['uat.teacher@smartlab.local'],
            );

            foreach ([
                'UAT-AST-PC001' => 'UAT-PC-001',
                'UAT-AST-PC002' => 'UAT-PC-002',
                'UAT-AST-PC101' => 'UAT-PC-101',
            ] as $assetCode => $deviceCode) {
                $asset = $assets[$assetCode];
                $device = $devices[$deviceCode];

                if ($asset->linked_device_id === null) {
                    $assets[$assetCode] = $this->assetService->linkDevice(
                        $context,
                        (string) $asset->id,
                        (int) $asset->version,
                        (string) $device->id,
                    );
                    continue;
                }

                if ((string) $asset->linked_device_id !== (string) $device->id) {
                    throw new RuntimeException(
                        "{$assetCode} sudah tertaut ke Device lain. Seeder berhenti fail-closed.",
                    );
                }
            }
        });

        $this->command?->info('SMARTLAB S1-S5 UAT fixtures ready.');
        $this->command?->info('Target School: '.$school->code.' · '.$school->name);
        $this->command?->info('Fixture accounts use password from '.self::PASSWORD_ENV.'.');
        $this->command?->info('No active Loan/Maintenance/WorkOrder custody was seeded.');
    }

    /**
     * @return array<string, SchoolMembership>
     */
    private function seedAccounts(string $schoolId, string $password): array
    {
        $memberships = [];

        foreach (self::ACCOUNTS as $email => $fixture) {
            $user = User::query()->updateOrCreate(
                ['email' => $email],
                [
                    'name' => $fixture['name'],
                    'password' => $password,
                    'nip' => $fixture['nip'] ?? null,
                    'nis' => $fixture['nis'] ?? null,
                    'status' => 'active',
                ],
            );

            $membership = SchoolMembership::query()->updateOrCreate(
                ['school_id' => $schoolId, 'user_id' => $user->id],
                ['status' => 'active'],
            );

            $role = Role::query()->where('key', $fixture['role'])->sole();
            $membership->roles()->sync([$role->id]);
            $memberships[$email] = $membership->refresh();
        }

        return $memberships;
    }

    /**
     * @return array<string, Laboratory>
     */
    private function seedLaboratories(string $schoolId): array
    {
        $fixtures = [
            'UAT-RPL1' => [
                'name' => 'Lab RPL 1 UAT',
                'location' => 'Gedung PPLG Lt. 2',
                'capacity' => 36,
            ],
            'UAT-RPL2' => [
                'name' => 'Lab RPL 2 UAT',
                'location' => 'Gedung PPLG Lt. 2',
                'capacity' => 36,
            ],
        ];

        $labs = [];
        foreach ($fixtures as $code => $fixture) {
            $labs[$code] = Laboratory::query()->updateOrCreate(
                ['school_id' => $schoolId, 'code' => $code],
                [
                    ...$fixture,
                    'status' => 'active',
                ],
            );
        }

        return $labs;
    }

    /**
     * @param array<string, Laboratory> $labs
     * @return array<string, Device>
     */
    private function seedDevices(CurrentMembershipContext $context, array $labs): array
    {
        $fixtures = [
            'UAT-PC-001' => [
                'lab' => 'UAT-RPL1',
                'serialNumber' => 'UAT-SN-PC001',
                'hostname' => 'uat-pc-001',
                'ramGB' => 8,
            ],
            'UAT-PC-002' => [
                'lab' => 'UAT-RPL1',
                'serialNumber' => 'UAT-SN-PC002',
                'hostname' => 'uat-pc-002',
                'ramGB' => 16,
            ],
            'UAT-PC-101' => [
                'lab' => 'UAT-RPL2',
                'serialNumber' => 'UAT-SN-PC101',
                'hostname' => 'uat-pc-101',
                'ramGB' => 16,
            ],
        ];

        $devices = [];
        foreach ($fixtures as $deviceCode => $fixture) {
            $lab = $labs[$fixture['lab']];
            $device = Device::query()
                ->where('school_id', $context->membership->school_id)
                ->where('device_code', $deviceCode)
                ->first();

            if ($device === null) {
                $devices[$deviceCode] = $this->deviceService->create($context, [
                    'deviceCode' => $deviceCode,
                    'deviceType' => 'desktop_pc',
                    'homeLaboratoryId' => (string) $lab->id,
                    'lifecycleStatus' => 'in_service',
                    'serialNumber' => $fixture['serialNumber'],
                    'hostname' => $fixture['hostname'],
                    'brand' => 'Lenovo',
                    'model' => 'ThinkCentre UAT',
                    'technicalProfile' => [
                        'processor' => 'Intel Core i5',
                        'ramGB' => $fixture['ramGB'],
                        'storageGB' => 512,
                        'gpu' => 'Intel UHD',
                        'os' => 'Windows 11',
                    ],
                ]);
                continue;
            }

            if ($device->device_type !== 'desktop_pc') {
                throw new RuntimeException("{$deviceCode} memiliki device_type berbeda dari fixture.");
            }
            if ($device->home_laboratory_id !== null
                && (string) $device->home_laboratory_id !== (string) $lab->id) {
                throw new RuntimeException(
                    "{$deviceCode} berada di home Laboratory lain. Seeder tidak melakukan transfer diam-diam.",
                );
            }
            if (in_array($device->lifecycle_status, ['retired', 'decommissioned'], true)) {
                throw new RuntimeException(
                    "{$deviceCode} sudah keluar dari active service. Seeder tidak menghidupkan ulang lifecycle.",
                );
            }

            $updates = [
                'lifecycleStatus' => 'in_service',
                'serialNumber' => $fixture['serialNumber'],
                'hostname' => $fixture['hostname'],
                'brand' => 'Lenovo',
                'model' => 'ThinkCentre UAT',
                'technicalProfile' => [
                    'processor' => 'Intel Core i5',
                    'ramGB' => $fixture['ramGB'],
                    'storageGB' => 512,
                    'gpu' => 'Intel UHD',
                    'os' => 'Windows 11',
                ],
            ];
            if ($device->home_laboratory_id === null) {
                $updates['homeLaboratoryId'] = (string) $lab->id;
            }

            $devices[$deviceCode] = $this->deviceService->update(
                $context,
                (string) $device->id,
                (int) $device->version,
                $updates,
            );
        }

        return $devices;
    }

    /**
     * @param array<string, Laboratory> $labs
     * @param array<string, Device> $devices
     * @return array<string, Asset>
     */
    private function seedAssets(
        CurrentMembershipContext $context,
        array $labs,
        array $devices,
    ): array {
        $fixtures = [
            'UAT-AST-PC001' => ['name' => 'PC UAT RPL1-001', 'lab' => 'UAT-RPL1', 'device' => 'UAT-PC-001'],
            'UAT-AST-PC002' => ['name' => 'PC UAT RPL1-002', 'lab' => 'UAT-RPL1', 'device' => 'UAT-PC-002'],
            'UAT-AST-PC101' => ['name' => 'PC UAT RPL2-101', 'lab' => 'UAT-RPL2', 'device' => 'UAT-PC-101'],
        ];

        $assets = [];
        foreach ($fixtures as $assetCode => $fixture) {
            $lab = $labs[$fixture['lab']];
            $device = $devices[$fixture['device']];

            $asset = Asset::query()
                ->where('school_id', $context->membership->school_id)
                ->where('asset_code', $assetCode)
                ->first();

            if ($asset === null) {
                $asset = $this->assetService->create($context, [
                    'assetCode' => $assetCode,
                    'name' => $fixture['name'],
                    'category' => 'Komputer',
                    'brand' => 'Lenovo',
                    'model' => 'ThinkCentre UAT',
                    'serialNumber' => $device->serial_number,
                    'homeLaboratoryId' => (string) $lab->id,
                    'condition' => 'good',
                    'acquisitionDate' => '2026-09-01',
                    'acquisitionYear' => 2026,
                    'fundingSource' => 'UAT',
                    'purchasePrice' => 10000000,
                    'supplierName' => 'Supplier UAT',
                    'notes' => 'Canonical S1-S5 UAT fixture',
                ]);
            } else {
                if ($asset->lifecycle_status !== 'active') {
                    throw new RuntimeException(
                        "{$assetCode} tidak lagi active. Seeder tidak mengubah lifecycle Asset.",
                    );
                }
                if ($asset->home_laboratory_id !== null
                    && (string) $asset->home_laboratory_id !== (string) $lab->id) {
                    throw new RuntimeException(
                        "{$assetCode} berada di home Laboratory lain. Seeder berhenti fail-closed.",
                    );
                }
                if ($asset->linked_device_id !== null
                    && (string) $asset->linked_device_id !== (string) $device->id) {
                    throw new RuntimeException(
                        "{$assetCode} sudah tertaut ke Device lain. Seeder berhenti fail-closed.",
                    );
                }
            }

            $assets[$assetCode] = $asset;
        }

        if (! Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->where('asset_code', 'UAT-AST-MEJA01')
            ->exists()) {
            $this->assetService->create($context, [
                'assetCode' => 'UAT-AST-MEJA01',
                'name' => 'Meja Instruktur UAT',
                'category' => 'Furniture',
                'homeLaboratoryId' => (string) $labs['UAT-RPL1']->id,
                'condition' => 'good',
                'acquisitionDate' => '2026-09-01',
                'acquisitionYear' => 2026,
                'fundingSource' => 'UAT',
                'purchasePrice' => 1500000,
                'supplierName' => 'Supplier UAT',
                'notes' => 'Asset-only fixture tanpa Device link untuk UAT/QR.',
            ]);
        }

        return $assets;
    }

    private function seedInventory(CurrentMembershipContext $context, User $actor): void
    {
        $fixtures = [
            'UAT-RAM-16GB' => [
                'name' => 'RAM DDR4 16GB UAT',
                'category' => 'Spare Part Komputer',
                'unit' => 'pcs',
                'minimumStock' => 2,
                'storageLocation' => 'Lemari Spare Part RPL1',
                'supplierName' => 'Supplier UAT',
                'unitPriceSnapshot' => 650000,
                'opening' => 6,
            ],
            'UAT-CABLE-LAN' => [
                'name' => 'Kabel LAN Cat6 UAT',
                'category' => 'Jaringan',
                'unit' => 'meter',
                'minimumStock' => 10,
                'storageLocation' => 'Lemari Jaringan RPL1',
                'supplierName' => 'Supplier UAT',
                'unitPriceSnapshot' => 12000,
                'opening' => 50.5,
            ],
        ];

        foreach ($fixtures as $itemCode => $fixture) {
            $item = InventoryItem::query()
                ->where('school_id', $context->membership->school_id)
                ->where('item_code', $itemCode)
                ->first();

            if ($item === null) {
                $item = $this->inventoryService->createItem($context, $actor, [
                    'itemCode' => $itemCode,
                    'name' => $fixture['name'],
                    'category' => $fixture['category'],
                    'unit' => $fixture['unit'],
                    'minimumStock' => $fixture['minimumStock'],
                    'storageLocation' => $fixture['storageLocation'],
                    'supplierName' => $fixture['supplierName'],
                    'unitPriceSnapshot' => $fixture['unitPriceSnapshot'],
                ]);
            } elseif ($item->unit !== $fixture['unit']) {
                throw new RuntimeException(
                    "{$itemCode} memiliki unit {$item->unit}; expected {$fixture['unit']}.",
                );
            }

            if (! $item->transactions()->exists()) {
                $this->inventoryService->transact($context, $actor, [
                    'inventoryItemId' => (string) $item->id,
                    'clientMutationId' => (string) Str::uuid(),
                    'kind' => 'opening',
                    'quantity' => $fixture['opening'],
                    'reason' => 'Opening balance S1-S5 UAT fixture',
                ]);
            }
        }
    }

    private function seedAcademicReference(
        string $schoolId,
        SchoolMembership $teacherMembership,
    ): void {
        $year = AcademicYear::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => '2026-2027'],
            [
                'name' => 'Tahun Ajaran 2026/2027',
                'starts_on' => '2026-07-01',
                'ends_on' => '2027-06-30',
                'status' => 'active',
                'version' => 1,
            ],
        );

        Semester::query()->firstOrCreate(
            ['academic_year_id' => $year->id, 'code' => 'GANJIL'],
            [
                'school_id' => $schoolId,
                'name' => 'Semester Ganjil 2026/2027',
                'starts_on' => '2026-07-01',
                'ends_on' => '2026-12-31',
                'status' => 'active',
                'version' => 1,
            ],
        );

        $unit = AcademicUnit::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'PPLG'],
            [
                'name' => 'Pengembangan Perangkat Lunak dan Gim',
                'type' => 'program',
                'parent_id' => null,
                'status' => 'active',
                'version' => 1,
            ],
        );

        $teacherUser = $teacherMembership->user()->sole();
        $teacher = Teacher::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'UAT-GURU'],
            [
                'personnel_number' => 'UAT-GURU',
                'name' => $teacherUser->name,
                'email' => $teacherUser->email,
                'phone' => null,
                'academic_unit_id' => $unit->id,
                'membership_id' => $teacherMembership->id,
                'status' => 'active',
                'version' => 1,
            ],
        );

        AcademicClass::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'XI-PPLG-1'],
            [
                'name' => 'XI PPLG 1',
                'grade_level' => 11,
                'academic_unit_id' => $unit->id,
                'homeroom_teacher_id' => $teacher->id,
                'student_count' => 36,
                'status' => 'active',
                'version' => 1,
            ],
        );

        Subject::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'PWEB'],
            [
                'name' => 'Pemrograman Web dan Mobile',
                'group_name' => 'Produktif PPLG',
                'academic_unit_id' => $unit->id,
                'status' => 'active',
                'version' => 1,
            ],
        );

        $periodSet = LessonPeriodSet::query()->firstOrCreate(
            ['academic_year_id' => $year->id, 'code' => 'REGULER'],
            [
                'school_id' => $schoolId,
                'name' => 'Jam Pelajaran Reguler',
                'status' => 'active',
                'version' => 1,
            ],
        );

        $periods = [
            ['JP1', 1, '07:00:00', '07:45:00', 'instruction'],
            ['JP2', 2, '07:45:00', '08:30:00', 'instruction'],
            ['JP3', 3, '08:30:00', '09:15:00', 'instruction'],
            ['IST1', 4, '09:15:00', '09:30:00', 'break'],
            ['JP4', 5, '09:30:00', '10:15:00', 'instruction'],
            ['JP5', 6, '10:15:00', '11:00:00', 'instruction'],
            ['JP6', 7, '11:00:00', '11:45:00', 'instruction'],
            ['IST2', 8, '11:45:00', '12:30:00', 'break'],
            ['JP7', 9, '12:30:00', '13:15:00', 'instruction'],
            ['JP8', 10, '13:15:00', '14:00:00', 'instruction'],
            ['JP9', 11, '14:00:00', '14:45:00', 'instruction'],
            ['JP10', 12, '14:45:00', '15:30:00', 'instruction'],
        ];

        foreach ($periods as [$code, $sequence, $startsAt, $endsAt, $kind]) {
            LessonPeriod::query()->firstOrCreate(
                ['lesson_period_set_id' => $periodSet->id, 'code' => $code],
                [
                    'school_id' => $schoolId,
                    'sequence' => $sequence,
                    'starts_at' => $startsAt,
                    'ends_at' => $endsAt,
                    'kind' => $kind,
                    'status' => 'active',
                    'version' => 1,
                ],
            );
        }
    }
}
