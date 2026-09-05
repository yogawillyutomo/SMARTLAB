<?php

namespace App\Application\Calendar;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Calendar\OperationalCalendarException;
use App\Models\Laboratory;
use App\Models\OperationalCalendarEvent;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OperationalCalendarMutationService
{
    public function __construct(private readonly OperationalCalendarEventRecorder $recorder) {}

    /** @param array<string,mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): OperationalCalendarEvent
    {
        return DB::transaction(function () use ($context,$actor,$data): OperationalCalendarEvent {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();
            $normalized = $this->normalizeAndValidate($schoolId, $data);

            $event = OperationalCalendarEvent::query()->create([
                'school_id'=>$schoolId,
                ...$normalized,
                'status'=>'active',
                'version'=>1,
                'cancelled_at'=>null,
            ]);

            $this->recorder->record($context,$actor,$event,'calendar_event.created',['after'=>$this->state($event)],0,1);
            return $event->refresh()->load('laboratory:id,school_id,code,name');
        });
    }

    /** @param array<string,mixed> $data */
    public function update(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): OperationalCalendarEvent
    {
        return DB::transaction(function () use ($context,$actor,$id,$expectedVersion,$data): OperationalCalendarEvent {
            $schoolId=(string)$context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();
            $event=OperationalCalendarEvent::query()->where('school_id',$schoolId)->whereKey($id)->lockForUpdate()->first();
            if(!$event) throw OperationalCalendarException::notFound();
            if($event->version!==$expectedVersion) throw OperationalCalendarException::versionConflict();
            if($event->status!=='active') throw OperationalCalendarException::conflict('Cancelled calendar events are immutable.');

            $before=$this->state($event);
            $candidate=$before;
            foreach(['scope','laboratoryId','category','availabilityEffect','title','description','startsOn','endsOn','allDay','startsAt','endsAt'] as $field){
                if(array_key_exists($field,$data)) $candidate[$field]=$data[$field];
            }
            $normalized=$this->normalizeAndValidate($schoolId,$candidate);
            $after=[
                'scope'=>$normalized['scope'],'laboratoryId'=>$normalized['laboratory_id'],'category'=>$normalized['category'],
                'availabilityEffect'=>$normalized['availability_effect'],'title'=>$normalized['title'],'description'=>$normalized['description'],
                'startsOn'=>$normalized['starts_on'],'endsOn'=>$normalized['ends_on'],'allDay'=>$normalized['all_day'],
                'startsAt'=>$normalized['starts_at'],'endsAt'=>$normalized['ends_at'],
            ];
            $comparableBefore=array_intersect_key($before,$after);
            if($comparableBefore===$after) return $event->load('laboratory:id,school_id,code,name');

            $versionBefore=$event->version;
            $event->fill($normalized);
            $event->version++;
            $event->save();
            $this->recorder->record($context,$actor,$event,'calendar_event.updated',['before'=>$comparableBefore,'after'=>$after],$versionBefore,$event->version);
            return $event->refresh()->load('laboratory:id,school_id,code,name');
        });
    }

    public function cancel(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion): OperationalCalendarEvent
    {
        return DB::transaction(function () use ($context,$actor,$id,$expectedVersion): OperationalCalendarEvent {
            $schoolId=(string)$context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();
            $event=OperationalCalendarEvent::query()->where('school_id',$schoolId)->whereKey($id)->lockForUpdate()->first();
            if(!$event) throw OperationalCalendarException::notFound();
            if($event->version!==$expectedVersion) throw OperationalCalendarException::versionConflict();
            if($event->status==='cancelled') return $event->load('laboratory:id,school_id,code,name');

            $versionBefore=$event->version;
            $event->status='cancelled';
            $event->cancelled_at=now();
            $event->version++;
            $event->save();
            $this->recorder->record($context,$actor,$event,'calendar_event.cancelled',['reason'=>'cancelled_by_authorized_user'],$versionBefore,$event->version);
            return $event->refresh()->load('laboratory:id,school_id,code,name');
        });
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function normalizeAndValidate(string $schoolId, array $data): array
    {
        $scope=(string)$data['scope'];
        $laboratoryId=$data['laboratoryId']??null;
        if($scope==='laboratory'){
            $lab=Laboratory::query()->where('school_id',$schoolId)->whereKey($laboratoryId)->first();
            if(!$lab) throw ValidationException::withMessages(['laboratoryId'=>['The selected Laboratory is invalid.']]);
            if($lab->status!=='active') throw ValidationException::withMessages(['laboratoryId'=>['The selected Laboratory is inactive.']]);
        } else {
            $laboratoryId=null;
        }

        $allDay=(bool)$data['allDay'];
        $startsOn=(string)$data['startsOn'];
        $endsOn=(string)$data['endsOn'];
        $startsAt=$allDay?null:substr((string)$data['startsAt'],0,5);
        $endsAt=$allDay?null:substr((string)$data['endsAt'],0,5);
        if($startsOn>$endsOn) throw ValidationException::withMessages(['endsOn'=>['End date must be on or after start date.']]);
        if(!$allDay && ($startsOn!==$endsOn || !$startsAt || !$endsAt || $startsAt>=$endsAt)){
            throw ValidationException::withMessages(['endsAt'=>['Partial-day events require one date and an end time after the start time.']]);
        }

        return [
            'scope'=>$scope,
            'laboratory_id'=>$laboratoryId,
            'category'=>$data['category'],
            'availability_effect'=>$data['availabilityEffect'],
            'title'=>trim((string)$data['title']),
            'description'=>isset($data['description']) && trim((string)$data['description'])!=='' ? trim((string)$data['description']) : null,
            'starts_on'=>$startsOn,
            'ends_on'=>$endsOn,
            'all_day'=>$allDay,
            'starts_at'=>$startsAt,
            'ends_at'=>$endsAt,
        ];
    }

    /** @return array<string,mixed> */
    private function state(OperationalCalendarEvent $event): array
    {
        return [
            'scope'=>$event->scope,'laboratoryId'=>$event->laboratory_id,'category'=>$event->category,
            'availabilityEffect'=>$event->availability_effect,'title'=>$event->title,'description'=>$event->description,
            'startsOn'=>$event->starts_on->format('Y-m-d'),'endsOn'=>$event->ends_on->format('Y-m-d'),
            'allDay'=>$event->all_day,'startsAt'=>$event->starts_at ? substr((string)$event->starts_at,0,5) : null,
            'endsAt'=>$event->ends_at ? substr((string)$event->ends_at,0,5) : null,
        ];
    }
}
