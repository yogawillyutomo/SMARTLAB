import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import { createWorkOrderGateway, parseWorkOrder, workOrderIfMatch, type WorkOrderDto } from '@/services/workOrderApi';

const ID='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SCHOOL='01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ASSET='01ARZ3NDEKTSV4RRFFQ69G5FAX';
const LAB='01ARZ3NDEKTSV4RRFFQ69G5FAY';
const MEMBER='01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const USER='01ARZ3NDEKTSV4RRFFQ69G5FB0';

function wo(overrides:Partial<WorkOrderDto>={}):WorkOrderDto{
 return {id:ID,schoolId:SCHOOL,workOrderNumber:'WO-2026-000001',incidentId:null,incidentTicketSnapshot:null,
 assetId:ASSET,assetCodeSnapshot:'AST-001',assetNameSnapshot:'PC 1',laboratoryId:LAB,laboratoryCodeSnapshot:'RPL1',
 laboratoryNameSnapshot:'Lab RPL 1',problemSummary:'PC tidak menyala',priority:'high',scheduledFor:'2026-09-08',notes:null,
 status:'in_progress',assigneeMembershipId:MEMBER,assigneeUserIdSnapshot:USER,assigneeMembershipIdSnapshot:MEMBER,
 assigneeNameSnapshot:'Teknisi',diagnosis:null,actionTaken:null,testResult:null,conditionBefore:'major_damage',conditionAfter:null,
 assetVersionAtStart:2,custodyActive:true,startedAt:'2026-09-07T05:00:00.000Z',completedAt:null,verifiedAt:null,cancelledAt:null,
 cancelReason:null,version:3,createdAt:'2026-09-07T04:00:00.000Z',updatedAt:'2026-09-07T05:00:00.000Z',...overrides};
}
function envelope(data=wo()){return {data};}
function client(overrides:Partial<ApiClient>={}):ApiClient{
 return {ensureCsrfCookie:vi.fn(async()=>undefined),get:vi.fn(async()=>envelope()) as ApiClient['get'],
 post:vi.fn(async()=>envelope()) as ApiClient['post'],put:vi.fn(async()=>envelope()) as ApiClient['put'],
 patch:vi.fn(async()=>envelope()) as ApiClient['patch'],delete:vi.fn(async()=>undefined) as ApiClient['delete'],...overrides};
}

describe('Work Order API contract',()=>{
 it('parses exact canonical fields and rejects browser-local drift',()=>{
   expect(parseWorkOrder(wo())).toEqual(wo());
   expect(()=>parseWorkOrder({...wo(),cost:10000})).toThrow();
   expect(()=>parseWorkOrder({...wo(),status:'repairing'})).toThrow();
 });
 it('uses strict If-Match',()=>{expect(workOrderIfMatch(3)).toBe('"3"');expect(()=>workOrderIfMatch(0)).toThrow();});
 it('uses explicit canonical lifecycle, parts, verify and history endpoints',async()=>{
   const get=vi.fn(async(path:string)=>path.endsWith('/history')
     ? {data:[{id:ID,workOrderId:ID,actorUserIdSnapshot:USER,actorMembershipIdSnapshot:MEMBER,actorNameSnapshot:'Teknisi',
       eventType:'work_order.started',beforeStatus:'assigned',afterStatus:'in_progress',payload:{},createdAt:'2026-09-07T05:00:00.000Z'}]}
     : path.startsWith('/work-orders?') ? {data:[wo()],meta:{page:1,perPage:200,total:1,lastPage:1}} : envelope());
   const post=vi.fn(async(path:string)=>path.endsWith('/parts')
     ? {data:wo({version:4}),partUsage:{id:'01ARZ3NDEKTSV4RRFFQ69G5FB1',schoolId:SCHOOL,workOrderId:ID,
       inventoryTransactionId:'01ARZ3NDEKTSV4RRFFQ69G5FB2',inventoryItemId:'01ARZ3NDEKTSV4RRFFQ69G5FB3',
       clientMutationId:'123e4567-e89b-42d3-a456-426614174000',itemCodeSnapshot:'SP-1',itemNameSnapshot:'RAM',unitSnapshot:'pcs',
       quantity:1,actorUserIdSnapshot:USER,actorMembershipIdSnapshot:MEMBER,actorNameSnapshot:'Teknisi',
       usedAt:'2026-09-07T05:10:00.000Z',createdAt:'2026-09-07T05:10:00.000Z'},meta:{replayed:false}}
     : envelope());
   const patch=vi.fn(async()=>envelope());
   const gateway=createWorkOrderGateway(client({get:get as ApiClient['get'],post:post as ApiClient['post'],patch:patch as ApiClient['patch']}));
   await gateway.listAll(); await gateway.history(ID); await gateway.assign(ID,3,{assigneeMembershipId:MEMBER});
   await gateway.start(ID,3); await gateway.hold(ID,3,'Perlu cek'); await gateway.waitingPart(ID,3,'Tunggu part');
   await gateway.resume(ID,3); await gateway.usePart(ID,3,{inventoryItemId:'01ARZ3NDEKTSV4RRFFQ69G5FB3',clientMutationId:'123e4567-e89b-42d3-a456-426614174000',quantity:1});
   await gateway.complete(ID,3,{diagnosis:'Rusak',actionTaken:'Ganti part',conditionAfter:'good'});
   await gateway.verify(ID,3); await gateway.rework(ID,3,'Tes ulang'); await gateway.cancel(ID,3,'Dibatalkan');
   expect(post).toHaveBeenCalledWith(`/work-orders/${ID}/verify`,{}, {ifMatch:'"3"'});
   expect(post).toHaveBeenCalledWith(`/work-orders/${ID}/parts`,expect.any(Object),{ifMatch:'"3"'});
   expect('delete' in gateway).toBe(false);
 });
});
