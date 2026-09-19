import { test, expect } from '@playwright/test';
const token='00000000-0000-4000-8000-000000000001';
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2WQAAAAASUVORK5CYII=';

async function isolated(page, { tracking=[] }={}) {
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        const json=body=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
        if(url.pathname.endsWith('/rpc/get_public_tracking')) return json(tracking);
        if(url.pathname==='/api/tracking-evidence.php') return json({url:'http://127.0.0.1:4173/test-pod.png'});
        if(url.pathname==='/test-pod.png') return route.fulfill({contentType:'image/png',body:Buffer.from(image,'base64')});
        if(url.origin==='http://127.0.0.1:4173') return route.continue();
        if(url.pathname.startsWith('/rest/v1/')) return json([]);
        // Never allow a release-profile browser test to reach live services.
        return route.abort('blockedbyclient');
    });
    return errors;
}

test('login and password recovery render without a live backend',async({page})=>{
    const errors=await isolated(page);
    await page.goto('/#/auth');
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await expect(page.getByRole('button',{name:'Crear nueva cuenta'})).toBeVisible();
    await page.getByRole('button', { name: '¿Olvidaste tu clave?' }).click();
    await expect(page.getByPlaceholder('tu@correo.com')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar enlace' })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('Configuración faltante');
    expect(errors).toEqual([]);
});

test('expired public tracking tokens display an explicit rejection',async({page})=>{
    const errors=await isolated(page);
    await page.goto(`/#/track/${token}`);
    await expect(page.getByRole('heading',{name:'Link no válido'})).toBeVisible();
    await expect(page.getByAltText('POD')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('anonymous recipient sees allowed evidence through the token endpoint',async({page})=>{
    const calls=[];
    page.on('request',request=>calls.push(request.url()));
    const errors=await isolated(page,{tracking:[{status:'completed',service_type:'delivery',pickup:'Origen sintético',dropoff:'Destino sintético',delivery_pod_url:'9/delivery/test.jpg'}]});
    await page.goto(`/#/track/${token}`);
    await expect(page.getByRole('heading',{name:'Entregado'})).toBeVisible();
    await expect(page.getByAltText('POD')).toBeVisible();
    expect(calls.some(url=>url.includes('/api/tracking-evidence.php?token='))).toBe(true);
    expect(calls.some(url=>url.includes('/storage/v1/object/sign'))).toBe(false);
    expect(errors).toEqual([]);
});

test('schedule is removed from launch navigation',async({page})=>{
    await isolated(page);
    await page.goto('/#/schedule');
    await expect(page).not.toHaveURL(/#\/schedule$/);
    await expect(page.locator('body')).not.toContainText('Diciembre 2024');
});
