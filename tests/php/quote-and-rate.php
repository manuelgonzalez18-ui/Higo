<?php
declare(strict_types=1);
require __DIR__ . '/../../public/api/_ride_quote.php';
require __DIR__ . '/../../public/api/_ratelimit.php';
function check(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
$config = ['GOOGLE_ROUTES_SERVER_KEY'=>'synthetic-google','SUPABASE_PROJECT_URL'=>'https://synthetic.supabase.test','SUPABASE_SERVICE_ROLE_KEY'=>'synthetic-service'];
$input = ['pickupCoords'=>['lat'=>10.46,'lng'=>-65.97],'dropoffCoords'=>['lat'=>10.47,'lng'=>-65.98], 'vehicleType'=>'standard','stops'=>[['lat'=>10.465,'lng'=>-65.975]],'routeDistanceKm'=>0.01,'routeDurationMin'=>0,'price'=>0.01];
$calls = [];
$transport = static function($url,$body,$headers) use (&$calls): array {
 $calls[] = [$url,$body,$headers];
 return count($calls) === 1 ? [200,['routes'=>[['distanceMeters'=>4500,'duration'=>'780s']]]] : [200,['quoteId'=>'synthetic-quote','finalPrice'=>7.5]];
};
$quote=higo_route_quote($input,'synthetic-user',$config,$transport);
check($quote['finalPrice']===7.5,'wrong quote');
check($calls[1][1]['p_distance_km']===4.5 && $calls[1][1]['p_duration_min']===13.0,'client metrics used');
check(count($calls[0][1]['intermediates'])===1,'stops omitted');
check($calls[1][1]['p_user_id']==='synthetic-user','wrong quote owner');
$calls = [];
higo_route_quote($input + ['promoCode'=>'0'],'synthetic-user',$config,$transport);
check($calls[1][1]['p_promo_code']==='0','numeric-string promotion silently dropped');
foreach ([['lat'=>91,'lng'=>0],['lat'=>0,'lng'=>181],['lat'=>null,'lng'=>1]] as $point) {
 try { higo_route_point($point); throw new RuntimeException('invalid coordinates accepted'); } catch (InvalidArgumentException $e) {}
}
foreach ([503,429,200] as $status) {
 try { higo_route_quote($input,'synthetic-user',$config,static fn()=>[$status,[]]); throw new LogicException('provider failure allowed'); }
 catch (RuntimeException $e) { check($e->getMessage()==='route_unavailable','unexpected provider failure'); }
}
foreach (['https://user:pass@example.com','http://example.com','https://example.com/path',"https://example.com\r\nInjected: true"] as $bad) {
 try { higo_backend_origin(['BASE'=>$bad],'BASE'); throw new LogicException('unsafe origin accepted'); } catch(RuntimeException $e) {}
}
check(api_client_ip(['REMOTE_ADDR'=>'192.0.2.1','HTTP_X_FORWARDED_FOR'=>'1.2.3.4'],[])==='192.0.2.1','untrusted header accepted');
check(api_client_ip(['REMOTE_ADDR'=>'192.0.2.1','HTTP_X_FORWARDED_FOR'=>'1.2.3.4, 192.0.2.2'],['192.0.2.1','192.0.2.2'])==='1.2.3.4','trusted chain rejected');
check(api_client_ip(['REMOTE_ADDR'=>'192.0.2.1','HTTP_X_FORWARDED_FOR'=>'forged, 198.51.100.2'],['192.0.2.1'])==='198.51.100.2','proxy boundary incorrect');
check(api_client_ip(['REMOTE_ADDR'=>'192.0.2.1','HTTP_CF_CONNECTING_IP'=>'1.2.3.4'],[])==='192.0.2.1','untrusted Cloudflare header accepted');
check(api_client_ip(['REMOTE_ADDR'=>'192.0.2.1','HTTP_X_FORWARDED_FOR'=>'invalid'],['192.0.2.1'])==='192.0.2.1','malformed trusted chain accepted');
$rateDir = sys_get_temp_dir() . '/higo-rate-window-' . bin2hex(random_bytes(8));
try {
 check(api_take_rate_slot($rateDir,'window',1,1000)===0,'first request rejected');
 check(api_take_rate_slot($rateDir,'window',1,1059)===1,'retry window incorrect');
 check(api_take_rate_slot($rateDir,'window',1,1060)===0,'window did not reopen');
 check(api_take_rate_slot($rateDir,'window',1,1060)===60,'reopened window exceeded');
 $failed = false;
 try { api_take_rate_slot(__FILE__,'window',1,1060); } catch(RuntimeException $e) { $failed=true; }
 check($failed,'unavailable storage did not fail closed');
} finally {
 foreach (glob($rateDir.'/*.json') ?: [] as $file) unlink($file);
 if (is_dir($rateDir)) rmdir($rateDir);
}
echo "PHP quote validation, provider failure, trusted-proxy checks passed\n";
