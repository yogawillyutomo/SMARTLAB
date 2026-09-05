import { describe,expect,it,vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import { createCalendarEventGateway,parseCalendarEvent,CalendarContractError } from '@/services/calendarApi';

const event={
 id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',schoolId:'01ARZ3NDEKTSV4RRFFQ69G5FAW',scope:'school' as const,laboratory:null,
 category:'holiday' as const,availabilityEffect:'blocked' as const,title:'Libur',description:null,
 startsOn:'2026-09-14',endsOn:'2026-09-14',allDay:true,startsAt:null,endsAt:null,status:'active' as const,version:1,
 cancelledAt:null,createdAt:'2026-09-05T00:00:00.000Z',updatedAt:'2026-09-05T00:00:00.000Z'
};
function client(overrides:Partial<ApiClient>={}):ApiClient{return{
 ensureCsrfCookie:vi.fn(async()=>undefined),get:vi.fn(async()=>({data:[event],meta:{page:1,perPage:500,total:1,lastPage:1}})) as ApiClient['get'],
 post:vi.fn(async()=>({data:event})) as ApiClient['post'],put:vi.fn() as ApiClient['put'],patch:vi.fn(async()=>({data:event})) as ApiClient['patch'],
 delete:vi.fn() as ApiClient['delete'],...overrides
};}

describe('calendar API contract',()=>{
 it('parses canonical event and rejects invalid scope/time shapes',()=>{
   expect(parseCalendarEvent(event)).toEqual(event);
   expect(()=>parseCalendarEvent({...event,scope:'laboratory'})).toThrow(CalendarContractError);
   expect(()=>parseCalendarEvent({...event,allDay:false,startsAt:null,endsAt:null})).toThrow(CalendarContractError);
 });
 it('uses exact list/create/update/cancel endpoints and If-Match versions',async()=>{
   const get=vi.fn(async()=>({data:[event],meta:{page:1,perPage:500,total:1,lastPage:1}}));
   const post=vi.fn(async()=>({data:event}));
   const patch=vi.fn(async()=>({data:event}));
   const gateway=createCalendarEventGateway(client({get:get as ApiClient['get'],post:post as ApiClient['post'],patch:patch as ApiClient['patch']}));
   await gateway.list({from:'2026-09-01',to:'2026-09-30'});
   await gateway.create({scope:'school',laboratoryId:null,category:'holiday',availabilityEffect:'blocked',title:'Libur',startsOn:'2026-09-14',endsOn:'2026-09-14',allDay:true,startsAt:null,endsAt:null});
   await gateway.update(event.id,1,{title:'Libur revisi'});
   await gateway.cancel(event.id,2);
   expect(get).toHaveBeenCalledWith('/calendar-events?from=2026-09-01&to=2026-09-30&status=active&perPage=500');
   expect(patch).toHaveBeenCalledWith(`/calendar-events/${event.id}`,{title:'Libur revisi'},{ifMatch:'"1"'});
   expect(post).toHaveBeenLastCalledWith(`/calendar-events/${event.id}/cancel`,undefined,{ifMatch:'"2"'});
 });
});
