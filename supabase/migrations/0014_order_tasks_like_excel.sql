-- Keep the task display order identical to the workbook columns:
-- SDB E:AM, then Chambre AN:BT.
with excel_order as (
  select source_column, ordinal - 1 as sort_order
  from unnest(array[
    'E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V',
    'W','X','Y','Z','AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM'
  ]::text[]) with ordinality as columns(source_column, ordinal)
)
update public.task_types as task
set sort_order = excel_order.sort_order,
    updated_at = now()
from excel_order
where task.zone = 'bathroom'
  and task.source_column = excel_order.source_column
  and task.sort_order is distinct from excel_order.sort_order;

with excel_order as (
  select source_column, ordinal - 1 as sort_order
  from unnest(array[
    'AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY','AZ','BA','BB','BC',
    'BD','BE','BF','BG','BH','BI','BJ','BK','BL','BM','BN','BO','BP','BQ','BR','BS','BT'
  ]::text[]) with ordinality as columns(source_column, ordinal)
)
update public.task_types as task
set sort_order = excel_order.sort_order,
    updated_at = now()
from excel_order
where task.zone = 'bedroom'
  and task.source_column = excel_order.source_column
  and task.sort_order is distinct from excel_order.sort_order;
