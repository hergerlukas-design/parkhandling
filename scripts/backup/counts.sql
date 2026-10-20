-- Zeilenzahlen der wichtigsten Tabellen; dump.sh und restore-test.sh vergleichen sie
select 'auth.users', count(*) from auth.users
union all select 'public.profiles', count(*) from public.profiles
union all select 'public.settings', count(*) from public.settings
union all select 'public.locations', count(*) from public.locations
union all select 'public.services', count(*) from public.services
union all select 'public.bookings', count(*) from public.bookings
union all select 'public.booking_services', count(*) from public.booking_services
union all select 'public.booking_history', count(*) from public.booking_history
union all select 'public.vehicle_movements', count(*) from public.vehicle_movements
union all select 'public.tasks', count(*) from public.tasks
union all select 'public.protocols', count(*) from public.protocols
union all select 'public.media', count(*) from public.media
union all select 'storage.objects', count(*) from storage.objects
order by 1;
