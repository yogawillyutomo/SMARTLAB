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
}
