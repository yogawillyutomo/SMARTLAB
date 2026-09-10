<?php

namespace App\Domain\Inventory;

class InventoryCatalog
{
    public const TRANSACTION_KINDS = [
        'opening',
        'receipt',
        'issue',
        'adjustment_in',
        'adjustment_out',
    ];

    public const UNITS = [
        'pcs',
        'unit',
        'set',
        'box',
        'pack',
        'roll',
        'meter',
        'liter',
        'kg',
        'gram',
        'botol',
    ];

    public const DISCRETE_UNITS = [
        'pcs',
        'unit',
        'set',
        'box',
        'pack',
        'roll',
        'botol',
    ];
}
