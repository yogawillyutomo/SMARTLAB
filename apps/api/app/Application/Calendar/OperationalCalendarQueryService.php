<?php

namespace App\Application\Calendar;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Calendar\OperationalCalendarException;
use App\Models\OperationalCalendarEvent;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class OperationalCalendarQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<OperationalCalendarEvent> */
    public function events(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query=OperationalCalendarEvent::query()
            ->where('school_id',$context->membership->school_id)
            ->whereDate('starts_on','<=',$filters['to'])
            ->whereDate('ends_on','>=',$filters['from'])
            ->with('laboratory:id,school_id,code,name')
            ->where('status',$filters['status']??'active');

        foreach(['scope'=>'scope','laboratoryId'=>'laboratory_id','category'=>'category','availabilityEffect'=>'availability_effect'] as $input=>$column){
            if(isset($filters[$input])) $query->where($column,$filters[$input]);
        }

        return $query->orderBy('starts_on')->orderByRaw('CASE WHEN starts_at IS NULL THEN 0 ELSE 1 END')->orderBy('starts_at')->orderBy('id')
            ->paginate(perPage:$filters['perPage']??100,columns:['*'],pageName:'page',page:$filters['page']??1);
    }

    public function event(CurrentMembershipContext $context,string $id): OperationalCalendarEvent
    {
        return OperationalCalendarEvent::query()->where('school_id',$context->membership->school_id)->whereKey($id)
            ->with('laboratory:id,school_id,code,name')->first() ?? throw OperationalCalendarException::notFound();
    }
}
