<?php

namespace App\Domain\Loan;

class LoanCatalog
{
    public const STATUSES = ['submitted', 'approved', 'rejected', 'cancelled', 'checked_out', 'returned', 'closed'];

    public const ASSET_LOANABLE_CONDITIONS = ['good', 'minor_damage'];

    public const DEVICE_LOANABLE_LIFECYCLES = ['in_service', 'spare'];
}
