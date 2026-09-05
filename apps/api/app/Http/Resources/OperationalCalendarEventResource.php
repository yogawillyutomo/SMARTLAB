<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OperationalCalendarEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'=>$this->id,'schoolId'=>$this->school_id,'scope'=>$this->scope,
            'laboratory'=>$this->laboratory_id===null?null:[
                'id'=>$this->laboratory_id,'code'=>$this->laboratory?->code,'name'=>$this->laboratory?->name,
            ],
            'category'=>$this->category,'availabilityEffect'=>$this->availability_effect,
            'title'=>$this->title,'description'=>$this->description,
            'startsOn'=>$this->starts_on?->format('Y-m-d'),'endsOn'=>$this->ends_on?->format('Y-m-d'),
            'allDay'=>$this->all_day,'startsAt'=>$this->starts_at?substr((string)$this->starts_at,0,5):null,
            'endsAt'=>$this->ends_at?substr((string)$this->ends_at,0,5):null,
            'status'=>$this->status,'version'=>$this->version,
            'cancelledAt'=>$this->cancelled_at?->toISOString(),
            'createdAt'=>$this->created_at?->toISOString(),'updatedAt'=>$this->updated_at?->toISOString(),
        ];
    }
}
