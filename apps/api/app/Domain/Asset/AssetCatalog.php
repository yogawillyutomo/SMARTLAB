<?php

namespace App\Domain\Asset;

class AssetCatalog
{
    public const CONDITIONS = ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'];

    public const LIFECYCLE_STATUSES = ['active', 'retired', 'disposed'];
}
