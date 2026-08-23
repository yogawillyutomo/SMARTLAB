<?php

namespace Tests\Unit;

use App\Domain\Device\DeviceTechnicalProfileValidator;
use PHPUnit\Framework\TestCase;

class DeviceTechnicalProfileValidatorTest extends TestCase
{
    private DeviceTechnicalProfileValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->validator = new DeviceTechnicalProfileValidator;
    }

    public function test_empty_profile_is_valid_for_every_device_type(): void
    {
        foreach ($this->deviceTypes() as $deviceType) {
            $this->assertSame([], $this->validator->validate($deviceType, []), $deviceType);
        }
    }

    public function test_representative_profiles_are_valid_for_all_ten_device_types(): void
    {
        foreach ($this->representativeProfiles() as $deviceType => $profile) {
            $this->assertSame([], $this->validator->validate($deviceType, $profile), $deviceType);
        }
    }

    public function test_type_specific_and_unknown_fields_are_rejected(): void
    {
        $this->assertArrayHasKey('technicalProfile.portCount', $this->validator->validate('desktop_pc', [
            'portCount' => 24,
        ]));
        $this->assertArrayHasKey('technicalProfile.unknown', $this->validator->validate('router', [
            'unknown' => true,
        ]));
    }

    public function test_frontend_discriminator_and_embedded_versions_are_rejected(): void
    {
        $errors = $this->validator->validate('desktop_pc', [
            'kind' => 'desktop_pc',
            'schemaVersion' => 1,
            'technicalProfileVersion' => 1,
        ]);

        $this->assertArrayHasKey('technicalProfile.kind', $errors);
        $this->assertArrayHasKey('technicalProfile.schemaVersion', $errors);
        $this->assertArrayHasKey('technicalProfile.technicalProfileVersion', $errors);
    }

    public function test_numeric_strings_and_invalid_numeric_ranges_are_rejected(): void
    {
        $this->assertArrayHasKey('technicalProfile.ramGB', $this->validator->validate('desktop_pc', ['ramGB' => '16']));
        $this->assertArrayHasKey('technicalProfile.ramGB', $this->validator->validate('desktop_pc', ['ramGB' => 0]));
        $this->assertArrayHasKey('technicalProfile.cpuSockets', $this->validator->validate('server', ['cpuSockets' => 0]));
        $this->assertArrayHasKey('technicalProfile.cpuSockets', $this->validator->validate('server', ['cpuSockets' => -1]));
        $this->assertArrayHasKey('technicalProfile.portCount', $this->validator->validate('network_switch', ['portCount' => 0]));
        $this->assertArrayHasKey('technicalProfile.portCount', $this->validator->validate('network_switch', ['portCount' => 1.5]));
        $this->assertArrayHasKey('technicalProfile.throughputMbps', $this->validator->validate('router', ['throughputMbps' => -0.1]));
        $this->assertArrayHasKey('technicalProfile.capacityVA', $this->validator->validate('ups', ['capacityVA' => INF]));
    }

    public function test_capabilities_require_real_booleans(): void
    {
        $this->assertArrayHasKey('technicalProfile.managed', $this->validator->validate('network_switch', ['managed' => 1]));
        $this->assertArrayHasKey('technicalProfile.wifiCapable', $this->validator->validate('router', ['wifiCapable' => 'true']));
        $this->assertArrayHasKey('technicalProfile.duplex', $this->validator->validate('printer', ['duplex' => 0]));
    }

    public function test_access_point_bands_are_closed_and_unique(): void
    {
        $this->assertSame([], $this->validator->validate('access_point', [
            'bands' => ['2.4GHz', '5GHz', '6GHz'],
        ]));
        $this->assertArrayHasKey('technicalProfile.bands', $this->validator->validate('access_point', [
            'bands' => ['5GHz', '5GHz'],
        ]));
        $this->assertArrayHasKey('technicalProfile.bands', $this->validator->validate('access_point', [
            'bands' => ['7GHz'],
        ]));
    }

    public function test_printer_technology_is_a_closed_enum(): void
    {
        foreach (['inkjet', 'laser', 'dot_matrix', 'thermal', 'other'] as $technology) {
            $this->assertSame([], $this->validator->validate('printer', ['technology' => $technology]));
        }

        $this->assertArrayHasKey('technicalProfile.technology', $this->validator->validate('printer', [
            'technology' => '3d',
        ]));
    }

    public function test_other_profile_accepts_at_most_32_flat_primitive_properties(): void
    {
        $profile = [];

        for ($index = 1; $index <= 32; $index++) {
            $profile['property_'.$index] = match ($index % 4) {
                0 => null,
                1 => 'value',
                2 => $index,
                default => true,
            };
        }

        $this->assertSame([], $this->validator->validate('other', $profile));

        $profile['property_33'] = false;
        $this->assertArrayHasKey('technicalProfile', $this->validator->validate('other', $profile));
    }

    public function test_other_profile_rejects_invalid_keys_nested_values_arrays_and_long_strings(): void
    {
        $this->assertArrayHasKey('technicalProfile.1invalid', $this->validator->validate('other', ['1invalid' => true]));
        $this->assertArrayHasKey('technicalProfile.'.str_repeat('a', 65), $this->validator->validate('other', [
            str_repeat('a', 65) => true,
        ]));
        $this->assertArrayHasKey('technicalProfile.nested', $this->validator->validate('other', [
            'nested' => ['value' => true],
        ]));
        $this->assertArrayHasKey('technicalProfile.items', $this->validator->validate('other', [
            'items' => ['one', 'two'],
        ]));
        $this->assertArrayHasKey('technicalProfile.notes', $this->validator->validate('other', [
            'notes' => str_repeat('x', 501),
        ]));
    }

    public function test_profile_serialized_size_is_bounded_to_16_kib(): void
    {
        $profile = [];

        for ($index = 1; $index <= 32; $index++) {
            $profile['property_'.str_pad((string) $index, 2, '0', STR_PAD_LEFT).str_repeat('k', 40)] = str_repeat('x', 500);
        }

        $this->assertArrayHasKey('technicalProfile', $this->validator->validate('other', $profile));
    }

    public function test_normalization_trims_profile_strings_without_coercing_json_types(): void
    {
        $normalized = $this->validator->normalize([
            'processor' => '  Example CPU  ',
            'ramGB' => 16,
            'enabled' => true,
            'nullable' => null,
        ]);

        $this->assertSame('Example CPU', $normalized['processor']);
        $this->assertSame(16, $normalized['ramGB']);
        $this->assertTrue($normalized['enabled']);
        $this->assertNull($normalized['nullable']);
    }

    /**
     * @return list<string>
     */
    private function deviceTypes(): array
    {
        return [
            'desktop_pc',
            'laptop',
            'server',
            'network_switch',
            'router',
            'access_point',
            'printer',
            'projector',
            'ups',
            'other',
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function representativeProfiles(): array
    {
        return [
            'desktop_pc' => ['processor' => 'Core i5', 'ramGB' => 16, 'storageGB' => 512, 'gpu' => 'Integrated', 'os' => 'Linux'],
            'laptop' => ['processor' => 'Ryzen 5', 'ramGB' => 16, 'storageGB' => 512, 'gpu' => 'Integrated', 'os' => 'Linux', 'display' => '14 inch'],
            'server' => ['processor' => 'Xeon', 'cpuSockets' => 2, 'cpuCores' => 16, 'ramGB' => 64, 'storageGB' => 2048, 'raidLevel' => 'RAID 1', 'os' => 'Linux'],
            'network_switch' => ['portCount' => 24, 'managed' => true, 'poe' => true, 'poeBudgetWatts' => 180, 'switchingCapacityGbps' => 56.5, 'uplinkSpeedGbps' => 10, 'firmwareVersion' => '1.2.3'],
            'router' => ['wanPortCount' => 2, 'lanPortCount' => 4, 'throughputMbps' => 1000.5, 'wifiCapable' => true, 'firmwareVersion' => '2.0'],
            'access_point' => ['wifiStandard' => 'Wi-Fi 6', 'bands' => ['2.4GHz', '5GHz'], 'maxClients' => 128, 'poe' => true, 'firmwareVersion' => '3.0'],
            'printer' => ['technology' => 'laser', 'color' => true, 'duplex' => true, 'networkCapable' => true, 'paperSize' => 'A4'],
            'projector' => ['technology' => 'DLP', 'brightnessLumens' => 4200, 'nativeResolution' => '1920x1080'],
            'ups' => ['capacityVA' => 1500, 'powerWatts' => 900, 'batteryCount' => 2, 'batteryVoltage' => 12, 'runtimeMinutes' => 30.5],
            'other' => ['customProperty' => 'custom value', 'quantity' => 2, 'enabled' => false, 'notes' => null],
        ];
    }
}
