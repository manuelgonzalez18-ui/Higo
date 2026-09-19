<?php
declare(strict_types=1);
require __DIR__ . '/../../public/api/_ratelimit.php';
$accepted=0;
for ($i=0;$i<8;$i++) if (api_take_rate_slot($argv[1],'same-user',10,1000)===0) $accepted++;
echo $accepted;
