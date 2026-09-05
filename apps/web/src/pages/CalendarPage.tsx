import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Plus, Pencil, Ban, ChevronLeft, ChevronRight, Download, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV, cn } from '@/utils';
import { hasServerPermission } from '@/lib/authIdentity';
import { useAuthStore } from '@/stores/authStore';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  calendarEventGateway,
  CalendarContractError,
  type CalendarAvailabilityEffect,
  type CalendarCategory,
  type CalendarEventDto,
  type CalendarEventInput,
  type CalendarScope,
} from '@/services/calendarApi';
import { ApiClientError } from '@/lib/apiClient';

const CATEGORIES:{value:CalendarCategory;label:string;color:string}[]=[
  {value:'effective_day',label:'Hari Efektif',color:'bg-success'},
  {value:'holiday',label:'Libur',color:'bg-danger'},
  {value:'exam',label:'Ujian',color:'bg-warning'},
  {value:'school_event',label:'Kegiatan Sekolah',color:'bg-info'},
  {value:'maintenance',label:'Maintenance',color:'bg-orange'},
  {value:'laboratory_closure',label:'Penutupan Lab',color:'bg-danger'},
  {value:'school_closure',label:'Penutupan Sekolah',color:'bg-danger'},
  {value:'workshop',label:'Workshop',color:'bg-status-cyan'},
  {value:'competition',label:'Kompetisi / LKS',color:'bg-info'},
  {value:'meeting',label:'Rapat',color:'bg-pink-500'},
  {value:'other',label:'Lainnya',color:'bg-base-600'},
];
const colorMap=Object.fromEntries(CATEGORIES.map((c)=>[c.value,c.color]));
const labelMap=Object.fromEntries(CATEGORIES.map((c)=>[c.value,c.label]));

function dateKey(date:Date):string{
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function monthRange(date:Date):{from:string;to:string}{
  return {from:dateKey(new Date(date.getFullYear(),date.getMonth(),1)),to:dateKey(new Date(date.getFullYear(),date.getMonth()+1,0))};
}
function defaultForm(date?:string):CalendarEventInput{
  const key=date??dateKey(new Date());
  return {scope:'school',laboratoryId:null,category:'school_event',availabilityEffect:'informational',title:'',description:null,startsOn:key,endsOn:key,allDay:true,startsAt:null,endsAt:null};
}
function inputFromEvent(event:CalendarEventDto):CalendarEventInput{
  return {scope:event.scope,laboratoryId:event.laboratory?.id??null,category:event.category,availabilityEffect:event.availabilityEffect,title:event.title,description:event.description,startsOn:event.startsOn,endsOn:event.endsOn,allDay:event.allDay,startsAt:event.startsAt,endsAt:event.endsAt};
}
function issueMessage(error:unknown):string{
  if(error instanceof CalendarContractError)return 'Respons kalender dari server tidak sesuai kontrak.';
  if(error instanceof ApiClientError){
    if(error.code==='CALENDAR_EVENT_VERSION_CONFLICT')return 'Event sudah berubah di server. Data terbaru telah dimuat ulang.';
    if(error.status===403)return 'Anda tidak memiliki izin untuk operasi kalender ini.';
    if(error.status===422)return Object.values(error.errors??{}).flat()[0]??'Data event belum valid.';
    if(error.kind==='network')return 'Layanan kalender tidak dapat dijangkau.';
  }
  return 'Operasi kalender gagal.';
}

export function CalendarPage(){
  const user=useAuthStore((s)=>s.user);
  const canCreate=hasServerPermission(user,'calendar.create');
  const canUpdate=hasServerPermission(user,'calendar.update');
  const canCancel=hasServerPermission(user,'calendar.cancel');
  const canExport=hasServerPermission(user,'calendar.export');

  const [view,setView]=useState<'month'|'week'|'agenda'>('month');
  const [current,setCurrent]=useState(new Date());
  const [events,setEvents]=useState<CalendarEventDto[]>([]);
  const [labs,setLabs]=useState<LaboratoryDto[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<CalendarEventDto|null>(null);
  const [detail,setDetail]=useState<CalendarEventDto|null>(null);
  const [confirmCancel,setConfirmCancel]=useState<CalendarEventDto|null>(null);
  const [filterCat,setFilterCat]=useState<string>('all');
  const [filterEffect,setFilterEffect]=useState<string>('all');
  const [form,setForm]=useState<CalendarEventInput>(()=>defaultForm());

  const range=useMemo(()=>monthRange(current),[current]);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{
      const calendar=await calendarEventGateway.list(range);
      setEvents(calendar);
      if(canCreate||canUpdate){
        const laboratories=await laboratoryGateway.list();
        setLabs(laboratories.filter((lab)=>lab.status==='active'));
      }else{
        setLabs([]);
      }
    }catch(err){setError(issueMessage(err));}
    finally{setLoading(false);}
  },[range,canCreate,canUpdate]);

  useEffect(()=>{void load();},[load]);

  const filtered=useMemo(()=>events.filter((event)=>
    (filterCat==='all'||event.category===filterCat)&&
    (filterEffect==='all'||event.availabilityEffect===filterEffect)
  ),[events,filterCat,filterEffect]);

  const monthData=useMemo(()=>{
    const year=current.getFullYear(),month=current.getMonth();
    const firstDay=new Date(year,month,1).getDay();
    const daysInMonth=new Date(year,month+1,0).getDate();
    const cells:(number|null)[]=[];
    for(let i=0;i<firstDay;i++)cells.push(null);
    for(let d=1;d<=daysInMonth;d++)cells.push(d);
    return {year,month,cells};
  },[current]);

  function eventsOnDate(key:string){return filtered.filter((e)=>e.startsOn<=key&&e.endsOn>=key);}
  function openCreate(key?:string){if(!canCreate)return;setEditing(null);setForm(defaultForm(key));setOpen(true);}
  function openEdit(event:CalendarEventDto){if(!canUpdate)return;setEditing(event);setForm(inputFromEvent(event));setOpen(true);}

  async function save(){
    if(editing?!canUpdate:!canCreate)return;
    if(!form.title.trim()){toast('Judul wajib diisi','error');return;}
    const payload:CalendarEventInput={...form,title:form.title.trim(),description:form.description?.trim()||null};
    if(payload.scope==='school')payload.laboratoryId=null;
    if(payload.allDay){payload.startsAt=null;payload.endsAt=null;}
    try{
      if(editing)await calendarEventGateway.update(editing.id,editing.version,payload);
      else await calendarEventGateway.create(payload);
      toast(editing?'Event diperbarui':'Event ditambahkan','success');
      setOpen(false);setEditing(null);await load();
    }catch(err){toast(issueMessage(err),'error');if(err instanceof ApiClientError&&err.code==='CALENDAR_EVENT_VERSION_CONFLICT'){setOpen(false);await load();}}
  }

  async function cancelEvent(){
    if(!confirmCancel||!canCancel)return;
    try{
      await calendarEventGateway.cancel(confirmCancel.id,confirmCancel.version);
      toast('Event dibatalkan tanpa menghapus riwayat','success');
      setConfirmCancel(null);setDetail(null);await load();
    }catch(err){toast(issueMessage(err),'error');await load();}
  }

  function exportCSV(){
    if(!canExport)return;
    downloadCSV('kalender-operasional.csv',filtered.map((e)=>({
      Judul:e.title,Mulai:e.startsOn,Selesai:e.endsOn,Waktu:e.allDay?'Seharian':`${e.startsAt}-${e.endsAt}`,
      Scope:e.scope==='school'?'Sekolah':e.laboratory?.name??'Laboratorium',Kategori:labelMap[e.category],
      Dampak:e.availabilityEffect==='blocked'?'Memblokir penggunaan lab':'Informasi',Deskripsi:e.description??'',
    })));
  }

  const agenda=[...filtered].sort((a,b)=>a.startsOn.localeCompare(b.startsOn)||(a.startsAt??'').localeCompare(b.startsAt??''));
  const weekStart=useMemo(()=>{const d=new Date(current);const day=d.getDay();d.setDate(d.getDate()-day);return d;},[current]);
  const weekDates=useMemo(()=>Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;}),[weekStart]);

  return <div className="space-y-6">
    <PageHeader title="Kalender Operasional" description="Event sekolah dan closure yang menjadi input availability tanpa mengubah jadwal TESSELA." icon={<CalendarRange className="h-5 w-5"/>}
      actions={<>
        {canExport&&<Button variant="secondary" size="sm" icon={<Download className="h-4 w-4"/>} onClick={exportCSV}>Export</Button>}
        {canCreate&&<Button size="sm" icon={<Plus className="h-4 w-4"/>} onClick={()=>openCreate()}>Tambah Event</Button>}
      </>}/>

    <Card><CardContent className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={()=>setCurrent(new Date(current.getFullYear(),current.getMonth()-1,1))}><ChevronLeft className="h-4 w-4"/></Button>
        <span className="min-w-[160px] text-center text-sm font-semibold text-ink-primary">{current.toLocaleDateString('id-ID',{month:'long',year:'numeric'})}</span>
        <Button variant="ghost" size="icon" onClick={()=>setCurrent(new Date(current.getFullYear(),current.getMonth()+1,1))}><ChevronRight className="h-4 w-4"/></Button>
      </div>
      <Button variant="ghost" size="sm" onClick={()=>setCurrent(new Date())}>Hari ini</Button>
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-base-700 p-1">
        {(['month','week','agenda'] as const).map((v)=><button key={v} onClick={()=>setView(v)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium',view===v?'bg-accent-primary text-accent-foreground':'text-ink-muted')}>{v==='month'?'Bulan':v==='week'?'Minggu':'Agenda'}</button>)}
      </div>
      <Select value={filterCat} onChange={(e)=>setFilterCat(e.target.value)} options={[{value:'all',label:'Semua kategori'},...CATEGORIES.map((c)=>({value:c.value,label:c.label}))]}/>
      <Select value={filterEffect} onChange={(e)=>setFilterEffect(e.target.value)} options={[{value:'all',label:'Semua dampak'},{value:'blocked',label:'Memblokir lab'},{value:'informational',label:'Informasi'}]}/>
    </CardContent></Card>

    <Card><CardContent className="flex items-start gap-3">
      <ShieldAlert className="mt-0.5 h-5 w-5 text-warning-foreground"/>
      <div className="text-sm">
        <p className="font-semibold text-ink-primary">Availability effect adalah sumber kebenaran operasional.</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">Event <b>blocked</b> pada scope sekolah akan memblokir seluruh laboratorium; scope laboratorium hanya memblokir lab yang dipilih. Kategori hanya menjelaskan konteks dan tidak menebak dampak secara otomatis.</p>
      </div>
    </CardContent></Card>

    {loading?<Card><LoadingState label="Memuat kalender canonical..."/></Card>:error?<Card><ErrorState message={error} onRetry={()=>void load()}/></Card>:view==='month'?(
      <Card><CardContent>
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-ink-muted">{['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map((d)=><div key={d} className="py-2 font-medium">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">{monthData.cells.map((day,i)=>{
          const key=day?dateKey(new Date(monthData.year,monthData.month,day)):'';
          const dayEvents=day?eventsOnDate(key):[];
          const isToday=key===dateKey(new Date());
          return <div key={i} onDoubleClick={()=>day&&openCreate(key)} className={cn('min-h-[100px] rounded-lg border p-1.5',day?'border-base-700/60 bg-base-800/40':'border-transparent',isToday&&'border-accent-content')}>
            {day&&<><p className={cn('text-xs',isToday?'font-bold text-accent-content':'text-ink-muted')}>{day}</p><div className="mt-1 space-y-1">
              {dayEvents.slice(0,3).map((e)=><button key={e.id} onClick={()=>setDetail(e)} className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-white',colorMap[e.category],e.availabilityEffect==='blocked'&&'ring-1 ring-danger/60')}>{e.title}</button>)}
              {dayEvents.length>3&&<p className="text-[10px] text-ink-muted">+{dayEvents.length-3} lainnya</p>}
            </div></>}
          </div>;
        })}</div>
      </CardContent></Card>
    ):view==='week'?(
      <Card><CardContent><div className="grid min-w-[980px] grid-cols-7 gap-2 overflow-x-auto">{weekDates.map((d)=>{
        const key=dateKey(d),dayEvents=eventsOnDate(key);
        return <div key={key} className="min-h-[150px] rounded-lg border border-base-700/60 bg-base-800/40 p-2">
          <p className="text-xs font-medium text-ink-secondary">{d.toLocaleDateString('id-ID',{weekday:'short',day:'numeric'})}</p>
          <div className="mt-2 space-y-1">{dayEvents.map((e)=><button key={e.id} onClick={()=>setDetail(e)} className={cn('block w-full rounded px-1.5 py-1 text-left text-[10px] text-white',colorMap[e.category])}>{e.allDay?'Seharian':e.startsAt} · {e.title}</button>)}</div>
        </div>;
      })}</div></CardContent></Card>
    ):(
      <Card>{agenda.length===0?<EmptyState title="Belum ada event pada bulan ini"/>:<div className="divide-y divide-base-700/40">{agenda.map((e)=><button key={e.id} onClick={()=>setDetail(e)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-base-700/30">
        <span className={cn('h-2.5 w-2.5 rounded-full',colorMap[e.category])}/><div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink-primary">{e.title}</p><p className="text-xs text-ink-muted">{e.startsOn}{e.endsOn!==e.startsOn?` - ${e.endsOn}`:''}{!e.allDay?` · ${e.startsAt}-${e.endsAt}`:''} · {e.scope==='school'?'Seluruh sekolah':e.laboratory?.name}</p></div>
        <Badge tone={e.availabilityEffect==='blocked'?'danger':'neutral'}>{e.availabilityEffect==='blocked'?'Blocked':'Informasi'}</Badge>
      </button>)}</div>}</Card>
    )}

    <div className="flex flex-wrap gap-3">{CATEGORIES.map((c)=><div key={c.value} className="flex items-center gap-1.5 text-xs text-ink-muted"><span className={cn('h-2.5 w-2.5 rounded-full',c.color)}/>{c.label}</div>)}</div>

    <FormDialog open={open} onClose={()=>setOpen(false)} title={editing?'Edit Event':'Tambah Event'} onSubmit={()=>void save()} size="lg">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Input label="Judul" value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})}/></div>
        <Select label="Scope" value={form.scope} onChange={(e)=>{const scope=e.target.value as CalendarScope;setForm({...form,scope,laboratoryId:scope==='school'?null:(form.laboratoryId??labs[0]?.id??null)});}} options={[{value:'school',label:'Seluruh sekolah'},{value:'laboratory',label:'Laboratorium tertentu'}]}/>
        {form.scope==='laboratory'?<Select label="Laboratorium" value={form.laboratoryId??''} onChange={(e)=>setForm({...form,laboratoryId:e.target.value})} options={labs.map((lab)=>({value:lab.id,label:`${lab.code} · ${lab.name}`}))}/>:<div/>}
        <Select label="Kategori" value={form.category} onChange={(e)=>setForm({...form,category:e.target.value as CalendarCategory})} options={CATEGORIES.map((c)=>({value:c.value,label:c.label}))}/>
        <Select label="Dampak ke Availability" value={form.availabilityEffect} onChange={(e)=>setForm({...form,availabilityEffect:e.target.value as CalendarAvailabilityEffect})} options={[{value:'informational',label:'Informasi saja'},{value:'blocked',label:'Blokir penggunaan laboratorium'}]}/>
        <Input label="Tanggal Mulai" type="date" value={form.startsOn} onChange={(e)=>setForm({...form,startsOn:e.target.value,endsOn:form.allDay?form.endsOn:e.target.value})}/>
        <Input label="Tanggal Selesai" type="date" value={form.endsOn} disabled={!form.allDay} onChange={(e)=>setForm({...form,endsOn:e.target.value})}/>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-ink-secondary"><input type="checkbox" checked={form.allDay} onChange={(e)=>setForm({...form,allDay:e.target.checked,endsOn:e.target.checked?form.endsOn:form.startsOn,startsAt:e.target.checked?null:(form.startsAt??'08:00'),endsAt:e.target.checked?null:(form.endsAt??'10:00')})}/> Seharian</label>
        {!form.allDay&&<><Input label="Jam Mulai" type="time" value={form.startsAt??''} onChange={(e)=>setForm({...form,startsAt:e.target.value})}/><Input label="Jam Selesai" type="time" value={form.endsAt??''} onChange={(e)=>setForm({...form,endsAt:e.target.value})}/></>}
        <div className="sm:col-span-2"><Textarea label="Deskripsi" value={form.description??''} onChange={(e)=>setForm({...form,description:e.target.value})}/></div>
      </div>
    </FormDialog>

    <Modal open={Boolean(detail)} onClose={()=>setDetail(null)} title={detail?.title} size="sm">{detail&&<div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2"><Badge tone="neutral">{labelMap[detail.category]}</Badge><Badge tone={detail.availabilityEffect==='blocked'?'danger':'neutral'}>{detail.availabilityEffect==='blocked'?'Memblokir lab':'Informasi'}</Badge></div>
      <div><p className="text-xs text-ink-muted">Scope</p><p className="text-ink-primary">{detail.scope==='school'?'Seluruh sekolah':detail.laboratory?.name}</p></div>
      <div><p className="text-xs text-ink-muted">Waktu</p><p className="text-ink-primary">{detail.startsOn}{detail.endsOn!==detail.startsOn?` - ${detail.endsOn}`:''}{!detail.allDay?` · ${detail.startsAt}-${detail.endsAt}`:' · Seharian'}</p></div>
      {detail.description&&<div><p className="text-xs text-ink-muted">Deskripsi</p><p className="text-ink-secondary">{detail.description}</p></div>}
      {(canUpdate||canCancel)&&<div className="flex gap-2 border-t border-base-700 pt-3">{canUpdate&&<Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5"/>} onClick={()=>{openEdit(detail);setDetail(null);}}>Edit</Button>}{canCancel&&<Button size="sm" variant="danger" icon={<Ban className="h-3.5 w-3.5"/>} onClick={()=>setConfirmCancel(detail)}>Batalkan</Button>}</div>}
    </div>}</Modal>

    <ConfirmDialog open={Boolean(confirmCancel)} onClose={()=>setConfirmCancel(null)} onConfirm={()=>void cancelEvent()} message={`Batalkan event "${confirmCancel?.title}"? Riwayat tetap disimpan untuk audit.`} confirmLabel="Batalkan Event"/>
  </div>;
}
