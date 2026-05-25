import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getUserProfile } from '../services/supabase';
import AdminNav from '../components/AdminNav';

// Categorías canónicas de tiendas
const STORE_CATEGORIES = [
    { id: 'restaurant', label: 'Restaurante' },
    { id: 'pharmacy', label: 'Farmacia' },
    { id: 'bakery', label: 'Panadería' },
    { id: 'grocery', label: 'Supermercado' },
    { id: 'cafe', label: 'Cafetería' }
];

// Fases de estado de Higo Shop (18 estados granulares)
const ORDER_STATUSES = [
    { id: 'PENDING_PRODUCT_PAYMENT', label: 'Pago de Producto Pendiente', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
    { id: 'PRODUCT_PAYMENT_REPORTED', label: 'Pago de Producto Reportado', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
    { id: 'PRODUCT_PAYMENT_VERIFIED', label: 'Pago de Producto Verificado', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
    { id: 'PREPARING', label: 'En Cocina / Preparando', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
    { id: 'READY_FOR_DRIVER_MATCH', label: 'Buscando Driver', color: 'bg-violet-500/10 text-violet-400 border-violet-500/30' },
    { id: 'DRIVER_CANDIDATE_BROADCASTED', label: 'Matchmaking Activo', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' },
    { id: 'DRIVER_ASSIGNED', label: 'Driver Asignado', color: 'bg-teal-500/10 text-teal-400 border-teal-500/30' },
    { id: 'DRIVER_EN_ROUTE_TO_STORE', label: 'Driver en Ruta a Tienda', color: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
    { id: 'PICKED_UP', label: 'Retirado por Driver', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
    { id: 'DRIVER_EN_ROUTE_TO_CUSTOMER', label: 'Driver en Ruta a Cliente', color: 'bg-pink-500/10 text-pink-400 border-pink-500/30' },
    { id: 'DELIVERY_PAYMENT_PENDING', label: 'Pago de Envío Pendiente', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
    { id: 'DELIVERY_PAYMENT_REPORTED', label: 'Pago de Envío Reportado', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
    { id: 'DELIVERY_PAYMENT_CONFIRMED', label: 'Pago de Envío Confirmado', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
    { id: 'DELIVERED', label: 'Entregado 🏁', color: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40' },
    { id: 'CANCELLED', label: 'Cancelado ❌', color: 'bg-red-500/10 text-red-400 border-red-500/30' }
];

export default function AdminShopPage() {
    const navigate = useNavigate();
    const [authorized, setAuthorized] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('stores'); // stores | products | orders | analytics
    const [message, setMessage] = useState(null);

    // Listas de datos
    const [stores, setStores] = useState([]);
    const [merchants, setMerchants] = useState([]); // Perfiles con rol 'merchant' o 'passenger' elegibles para ser dueños de tienda
    const [products, setProducts] = useState([]);
    const [orders, setOrders] = useState([]);
    const [drivers, setDrivers] = useState([]); // Conductores elegibles para reasignación

    // Filtros de búsqueda
    const [storeSearch, setStoreSearch] = useState('');
    const [selectedStoreId, setSelectedStoreId] = useState('all');
    const [orderFilterStatus, setOrderFilterStatus] = useState('all');

    // Modales y formularios
    const [showStoreModal, setShowStoreModal] = useState(false);
    const [editingStore, setEditingStore] = useState(null);
    const [storeForm, setStoreForm] = useState({
        owner_id: '',
        name: '',
        category: 'restaurant',
        description: '',
        address: '',
        phone: '',
        latitude: 10.4862,
        longitude: -66.0944,
        is_open: true,
        open_hours: '8:00 AM - 10:00 PM',
        pago_movil_phone: '',
        pago_movil_bank: '',
        pago_movil_cedula: '',
        pago_movil_holder: ''
    });

    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [productForm, setProductForm] = useState({
        store_id: '',
        name: '',
        description: '',
        price: '',
        category: 'Platos',
        available: true,
        image_url: ''
    });

    // Validar autorización del administrador
    useEffect(() => {
        (async () => {
            const profile = await getUserProfile();
            if (!profile || profile.role !== 'admin') {
                navigate('/');
                return;
            }
            setAuthorized(true);
        })();
    }, [navigate]);

    // Cargar toda la data de Supabase
    const loadAllData = useCallback(async () => {
        if (!authorized) return;
        setIsLoading(true);
        try {
            // 1. Cargar Tiendas
            const { data: storesData } = await supabase
                .from('stores')
                .select('*')
                .order('created_at', { ascending: false });
            setStores(storesData || []);

            // Cargar primer store_id disponible para el filtro
            if (storesData && storesData.length > 0 && selectedStoreId === 'all') {
                setProductForm(prev => ({ ...prev, store_id: storesData[0].id }));
            }

            // 2. Cargar perfiles merchants y admins
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, full_name, phone, role')
                .in('role', ['merchant', 'passenger', 'admin']);
            setMerchants(profilesData || []);

            // 3. Cargar Productos
            const { data: productsData } = await supabase
                .from('products')
                .select('*, stores(name)')
                .order('created_at', { ascending: false });
            setProducts(productsData || []);

            // 4. Cargar Órdenes
            const { data: ordersData } = await supabase
                .from('orders')
                .select('*, stores(name), profiles:customer_id(full_name, phone)')
                .order('created_at', { ascending: false });
            setOrders(ordersData || []);

            // 5. Cargar Drivers para emergencias
            const { data: driversData } = await supabase
                .from('profiles')
                .select('id, full_name, phone')
                .eq('role', 'driver');
            setDrivers(driversData || []);

        } catch (err) {
            console.error("Error loading administrative data:", err.message);
            setMessage({ type: 'error', text: 'Error al recuperar información de la base de datos.' });
        } finally {
            setIsLoading(false);
        }
    }, [authorized, selectedStoreId]);

    useEffect(() => {
        loadAllData();
    }, [loadAllData]);

    const handleTriggerAlert = (type, text) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 5000);
    };

    // ==========================================
    // GESTIÓN DE TIENDAS / COMERCIOS
    // ==========================================
    const openAddStore = () => {
        setEditingStore(null);
        setStoreForm({
            owner_id: merchants[0]?.id || '',
            name: '',
            category: 'restaurant',
            description: '',
            address: '',
            phone: '',
            latitude: 10.4862,
            longitude: -66.0944,
            is_open: true,
            open_hours: '8:00 AM - 10:00 PM',
            pago_movil_phone: '',
            pago_movil_bank: '0102',
            pago_movil_cedula: '',
            pago_movil_holder: ''
        });
        setShowStoreModal(true);
    };

    const openEditStore = (store) => {
        setEditingStore(store);
        setStoreForm({
            owner_id: store.owner_id || '',
            name: store.name,
            category: store.category,
            description: store.description || '',
            address: store.address || '',
            phone: store.phone || '',
            latitude: store.latitude,
            longitude: store.longitude,
            is_open: store.is_open,
            open_hours: store.open_hours || '8:00 AM - 10:00 PM',
            pago_movil_phone: store.pago_movil?.phone || '',
            pago_movil_bank: store.pago_movil?.bank || '0102',
            pago_movil_cedula: store.pago_movil?.cedula || '',
            pago_movil_holder: store.pago_movil?.holder || ''
        });
        setShowStoreModal(true);
    };

    const handleSaveStore = async (e) => {
        e.preventDefault();
        if (!storeForm.name || !storeForm.phone || !storeForm.address) {
            alert("Completa todos los campos obligatorios.");
            return;
        }

        const payload = {
            owner_id: storeForm.owner_id || null,
            name: storeForm.name,
            category: storeForm.category,
            description: storeForm.description,
            address: storeForm.address,
            phone: storeForm.phone,
            latitude: parseFloat(storeForm.latitude),
            longitude: parseFloat(storeForm.longitude),
            is_open: storeForm.is_open,
            open_hours: storeForm.open_hours,
            pago_movil: {
                phone: storeForm.pago_movil_phone,
                bank: storeForm.pago_movil_bank,
                cedula: storeForm.pago_movil_cedula,
                holder: storeForm.pago_movil_holder
            }
        };

        try {
            if (editingStore) {
                // Modificar en Supabase
                const { error } = await supabase
                    .from('stores')
                    .update(payload)
                    .eq('id', editingStore.id);
                if (error) throw error;
                handleTriggerAlert('success', `Tienda "${storeForm.name}" modificada correctamente.`);
            } else {
                // Crear en Supabase
                const { error } = await supabase
                    .from('stores')
                    .insert([payload]);
                if (error) throw error;
                handleTriggerAlert('success', `Tienda "${storeForm.name}" creada con éxito.`);
            }
            setShowStoreModal(false);
            loadAllData();
        } catch (err) {
            console.error("Error saving store:", err.message);
            handleTriggerAlert('error', err.message);
        }
    };

    const handleDeleteStore = async (storeId, storeName) => {
        if (!confirm(`¿Estás 100% seguro de eliminar el comercio "${storeName}"? Esto borrará todos sus productos asociados en cascada.`)) return;

        try {
            const { error } = await supabase
                .from('stores')
                .delete()
                .eq('id', storeId);
            if (error) throw error;
            handleTriggerAlert('success', `Tienda "${storeName}" eliminada.`);
            loadAllData();
        } catch (err) {
            handleTriggerAlert('error', err.message);
        }
    };

    // ==========================================
    // GESTIÓN DE PRODUCTOS / CRUD
    // ==========================================
    const openAddProduct = () => {
        setEditingProduct(null);
        setProductForm({
            store_id: stores[0]?.id || '',
            name: '',
            description: '',
            price: '',
            category: 'Platos',
            available: true,
            image_url: ''
        });
        setShowProductModal(true);
    };

    const openEditProduct = (prod) => {
        setEditingProduct(prod);
        setProductForm({
            store_id: prod.store_id,
            name: prod.name,
            description: prod.description || '',
            price: prod.price.toString(),
            category: prod.category,
            available: prod.available ?? true,
            image_url: prod.image_url || ''
        });
        setShowProductModal(true);
    };

    const handleSaveProduct = async (e) => {
        e.preventDefault();
        if (!productForm.name || !productForm.price || !productForm.store_id) {
            alert("Completa todos los campos obligatorios del producto.");
            return;
        }

        const payload = {
            store_id: productForm.store_id,
            name: productForm.name,
            description: productForm.description,
            price: parseFloat(productForm.price),
            category: productForm.category,
            available: productForm.available,
            image_url: productForm.image_url || null
        };

        try {
            if (editingProduct) {
                const { error } = await supabase
                    .from('products')
                    .update(payload)
                    .eq('id', editingProduct.id);
                if (error) throw error;
                handleTriggerAlert('success', `Producto "${productForm.name}" modificado.`);
            } else {
                const { error } = await supabase
                    .from('products')
                    .insert([payload]);
                if (error) throw error;
                handleTriggerAlert('success', `Producto "${productForm.name}" añadido al catálogo.`);
            }
            setShowProductModal(false);
            loadAllData();
        } catch (err) {
            handleTriggerAlert('error', err.message);
        }
    };

    const handleDeleteProduct = async (prodId, prodName) => {
        if (!confirm(`¿Eliminar definitivamente el producto "${prodName}" del menú?`)) return;

        try {
            const { error } = await supabase
                .from('products')
                .delete()
                .eq('id', prodId);
            if (error) throw error;
            handleTriggerAlert('success', `Producto "${prodName}" eliminado.`);
            loadAllData();
        } catch (err) {
            handleTriggerAlert('error', err.message);
        }
    };

    // ==========================================
    // ACCIONES DE EMERGENCIA DE PEDIDOS
    // ==========================================
    const handleForceOrderStatus = async (orderId, newStatus) => {
        if (!confirm(`¿Forzar el cambio de estado de la orden a: ${newStatus}?`)) return;

        try {
            const { error } = await supabase
                .from('orders')
                .update({ status: newStatus })
                .eq('id', orderId);
            if (error) throw error;
            
            // Registrar auditoría en order_events
            await supabase.from('order_events').insert([{
                order_id: orderId,
                event_type: `FORCED_TO_${newStatus}`,
                actor_type: 'system',
                payload: { note: 'Cambio de estado forzado manualmente por el Administrador de Higo.' }
            }]);

            handleTriggerAlert('success', `Estado forzado a ${newStatus} correctamente.`);
            loadAllData();
        } catch (err) {
            handleTriggerAlert('error', err.message);
        }
    };

    const handleAssignEmergencyDriver = async (orderId, driverId, driverName) => {
        if (!confirm(`¿Asignar de emergencia al conductor "${driverName}" a este despacho?`)) return;

        try {
            const { error } = await supabase
                .from('orders')
                .update({ 
                    driver_id: driverId,
                    status: 'DRIVER_ASSIGNED' 
                })
                .eq('id', orderId);
            if (error) throw error;

            await supabase.from('order_events').insert([{
                order_id: orderId,
                event_type: 'EMERGENCY_DRIVER_ASSIGNED',
                actor_type: 'system',
                payload: { driver_id: driverId, driver_name: driverName, note: 'Conductor asignado por contingencia desde el panel admin.' }
            }]);

            handleTriggerAlert('success', `Conductor ${driverName} asignado.`);
            loadAllData();
        } catch (err) {
            handleTriggerAlert('error', err.message);
        }
    };

    // ==========================================
    // FILTRADO DE DATOS (CLIENT SIDE SEARCH)
    // ==========================================
    const filteredStores = useMemo(() => {
        return stores.filter(s => {
            const q = storeSearch.toLowerCase();
            return !q || s.name.toLowerCase().includes(q) || s.phone.includes(q) || s.address.toLowerCase().includes(q);
        });
    }, [stores, storeSearch]);

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            return selectedStoreId === 'all' || p.store_id === selectedStoreId;
        });
    }, [products, selectedStoreId]);

    const filteredOrders = useMemo(() => {
        return orders.filter(o => {
            return orderFilterStatus === 'all' || o.status === orderFilterStatus;
        });
    }, [orders, orderFilterStatus]);

    // ==========================================
    // METRICAS / ANALITICAS DE TIENDAS
    // ==========================================
    const shopMetrics = useMemo(() => {
        const completed = orders.filter(o => o.status === 'DELIVERED');
        const grossVolume = completed.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const productVolume = completed.reduce((sum, o) => sum + (Number(o.total) - Number(o.delivery_fee) || 0), 0);
        const deliveryVolume = completed.reduce((sum, o) => sum + (Number(o.delivery_fee) || 0), 0);
        const ticketAverage = completed.length > 0 ? (grossVolume / completed.length) : 0;

        // TOP tiendas por volumen
        const storeLeaderboard = {};
        completed.forEach(o => {
            const storeName = o.stores?.name || 'Comercio Desconocido';
            storeLeaderboard[storeName] = (storeLeaderboard[storeName] || 0) + Number(o.total);
        });
        const leaderSorted = Object.entries(storeLeaderboard)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        return {
            completedCount: completed.length,
            activeOrdersCount: orders.filter(o => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length,
            grossVolume,
            productVolume,
            deliveryVolume,
            ticketAverage,
            leaderSorted
        };
    }, [orders]);


    if (!authorized) {
        return (
            <div className="min-h-screen bg-[#0F1014] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0F1014] p-4 md:p-8 font-sans text-white">
            <AdminNav />

            {/* Encabezado */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-violet-600 to-indigo-600 p-3 rounded-2xl shadow-lg shadow-violet-600/20">
                        <span className="material-symbols-outlined text-white text-2xl">shopping_bag</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight">Consola Higo Shop</h1>
                        <p className="text-gray-400 text-sm font-medium">Audita comercios, catálogos, pedidos y volumen de ventas</p>
                    </div>
                </div>

                <div className="flex gap-2 bg-[#1A1F2E] p-1.5 rounded-xl border border-white/5">
                    {[
                        { id: 'stores', label: 'Comercios', icon: 'storefront' },
                        { id: 'products', label: 'Productos', icon: 'fastfood' },
                        { id: 'orders', label: 'Pedidos', icon: 'list_alt' },
                        { id: 'analytics', label: 'Analytics', icon: 'trending_up' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-sm transition-all ${activeTab === tab.id
                                ? 'bg-violet-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {message && (
                <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${message.type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                    <span className="material-symbols-outlined">{message.type === 'success' ? 'check_circle' : 'error'}</span>
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            {isLoading ? (
                <div className="flex justify-center py-20">
                    <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <>
                    {/* ==========================================
                        SECCIÓN COMERCIOS
                        ========================================== */}
                    {activeTab === 'stores' && (
                        <div className="space-y-6">
                            <div className="bg-[#1A1F2E] p-5 rounded-[24px] border border-white/5 flex flex-col md:flex-row gap-4 justify-between items-center">
                                <div className="relative w-full md:w-96">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 material-symbols-outlined">search</span>
                                    <input
                                        type="text"
                                        placeholder="Buscar tienda por nombre, teléfono o dirección..."
                                        className="w-full pl-12 pr-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500/50 text-white placeholder:text-gray-600"
                                        value={storeSearch}
                                        onChange={(e) => setStoreSearch(e.target.value)}
                                    />
                                </div>
                                <button
                                    onClick={openAddStore}
                                    className="w-full md:w-auto px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-violet-600/15"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add_business</span>
                                    Registrar Tienda
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {filteredStores.length === 0 ? (
                                    <div className="col-span-2 text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                                        <span className="material-symbols-outlined text-gray-500 text-4xl">storefront</span>
                                        <p className="text-gray-400 font-medium mt-2">No se encontraron comercios registrados.</p>
                                    </div>
                                ) : filteredStores.map(s => (
                                    <div key={s.id} className="bg-[#1A1F2E] p-5 rounded-[20px] border border-white/5 hover:border-white/10 transition-all flex flex-col justify-between">
                                        <div>
                                            <div className="flex items-start justify-between gap-4 mb-3">
                                                <div>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-1 border ${
                                                        s.category === 'restaurant' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                                                        s.category === 'pharmacy' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' :
                                                        'bg-gray-500/10 text-gray-300 border-gray-500/20'
                                                    }`}>
                                                        {s.category.toUpperCase()}
                                                    </span>
                                                    <h3 className="font-extrabold text-lg text-white">{s.name}</h3>
                                                    <p className="text-xs text-gray-400 line-clamp-1">{s.description || 'Sin descripción descriptiva.'}</p>
                                                </div>
                                                <div className="flex items-center gap-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-2 py-1 rounded-lg text-xs font-black shrink-0">
                                                    <span className="material-symbols-outlined text-[14px]">star</span>
                                                    {s.rating?.toFixed(1) || '5.0'}
                                                </div>
                                            </div>

                                            <div className="space-y-1.5 text-xs text-gray-400 mb-4 font-medium">
                                                <div className="flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-[16px] text-gray-500">call</span>
                                                    {s.phone}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-[16px] text-gray-500">pin_drop</span>
                                                    <span className="truncate">{s.address}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-[16px] text-gray-500">payments</span>
                                                    <span>PM: {s.pago_movil?.bank || '—'} · {s.pago_movil?.phone || '—'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between border-t border-white/5 pt-4">
                                            <span className={`flex items-center gap-1.5 text-xs font-bold ${s.is_open ? 'text-green-400' : 'text-red-400'}`}>
                                                <span className={`w-2 h-2 rounded-full ${s.is_open ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                                {s.is_open ? 'Abierto' : 'Cerrado'}
                                            </span>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => openEditStore(s)}
                                                    className="p-2 rounded-lg bg-[#0F1014] text-gray-400 hover:text-white border border-white/10 transition-colors"
                                                    title="Editar parámetros del comercio"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">edit</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteStore(s.id, s.name)}
                                                    className="p-2 rounded-lg bg-[#0F1014] text-red-400/70 hover:text-red-400 border border-white/10 hover:bg-red-500/10 transition-colors"
                                                    title="Eliminar comercio"
                                                >
                                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ==========================================
                        SECCIÓN PRODUCTOS (CRUD)
                        ========================================== */}
                    {activeTab === 'products' && (
                        <div className="space-y-6">
                            <div className="bg-[#1A1F2E] p-5 rounded-[24px] border border-white/5 flex flex-col md:flex-row gap-4 justify-between items-center">
                                <div className="flex items-center gap-3 w-full md:w-auto">
                                    <span className="text-sm font-bold text-gray-400">Filtrar por Tienda:</span>
                                    <select
                                        className="bg-[#0F1014] border border-white/10 text-white rounded-xl px-4 py-2.5 outline-none focus:border-violet-500 text-sm font-bold"
                                        value={selectedStoreId}
                                        onChange={(e) => setSelectedStoreId(e.target.value)}
                                    >
                                        <option value="all">Todas las tiendas</option>
                                        {stores.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    onClick={openAddProduct}
                                    className="w-full md:w-auto px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-violet-600/15"
                                >
                                    <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
                                    Crear Producto
                                </button>
                            </div>

                            <div className="bg-[#1A1F2E] rounded-[24px] border border-white/5 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-sm">
                                        <thead>
                                            <tr className="border-b border-white/5 text-gray-500 font-bold text-xs uppercase bg-[#0F1014]/50">
                                                <th className="p-4 pl-6">Producto</th>
                                                <th className="p-4">Tienda</th>
                                                <th className="p-4">Precio</th>
                                                <th className="p-4">Categoría</th>
                                                <th className="p-4">Disponibilidad</th>
                                                <th className="p-4 pr-6 text-right">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5 font-medium">
                                            {filteredProducts.length === 0 ? (
                                                <tr>
                                                    <td colSpan="6" className="text-center py-20 text-gray-500">
                                                        No hay productos en esta tienda o filtro.
                                                    </td>
                                                </tr>
                                            ) : filteredProducts.map(p => (
                                                <tr key={p.id} className="hover:bg-white/[0.01] transition-colors">
                                                    <td className="p-4 pl-6">
                                                        <div className="flex items-center gap-3">
                                                            {p.image_url ? (
                                                                <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0" />
                                                            ) : (
                                                                <div className="w-10 h-10 rounded-lg bg-[#0F1014] border border-white/5 flex items-center justify-center text-gray-600 shrink-0">
                                                                    <span className="material-symbols-outlined text-[18px]">fastfood</span>
                                                                </div>
                                                            )}
                                                            <div>
                                                                <p className="font-bold text-white leading-tight">{p.name}</p>
                                                                <p className="text-xs text-gray-400 line-clamp-1 max-w-[240px] font-normal">{p.description || 'Sin descripción.'}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 text-gray-300 font-bold">{p.stores?.name || 'Tienda Desconocida'}</td>
                                                    <td className="p-4 font-mono font-bold text-white">${p.price.toFixed(2)}</td>
                                                    <td className="p-4 text-gray-400 font-bold">{p.category}</td>
                                                    <td className="p-4">
                                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${p.available ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                                            <span className={`w-1.5 h-1.5 rounded-full ${p.available ? 'bg-green-500' : 'bg-red-500'}`} />
                                                            {p.available ? 'Disponible' : 'Agotado'}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 pr-6 text-right">
                                                        <div className="flex gap-2 justify-end">
                                                            <button
                                                                onClick={() => openEditProduct(p)}
                                                                className="px-2.5 py-1.5 bg-[#0F1014] text-gray-300 hover:text-white rounded-lg border border-white/10 hover:border-violet-500/50 text-xs font-bold flex items-center gap-1 transition-colors"
                                                            >
                                                                <span className="material-symbols-outlined text-[14px]">edit</span>
                                                                Editar
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteProduct(p.id, p.name)}
                                                                className="px-2.5 py-1.5 bg-[#0F1014] text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-white/10 text-xs font-bold flex items-center gap-1 transition-colors"
                                                            >
                                                                <span className="material-symbols-outlined text-[14px]">delete</span>
                                                                Borrar
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ==========================================
                        SECCIÓN PEDIDOS / MONITOREO
                        ========================================== */}
                    {activeTab === 'orders' && (
                        <div className="space-y-6">
                            <div className="bg-[#1A1F2E] p-5 rounded-[24px] border border-white/5 flex flex-col md:flex-row gap-4 justify-between items-center">
                                <div className="flex items-center gap-3 w-full md:w-auto">
                                    <span className="text-sm font-bold text-gray-400">Filtrar por Estado:</span>
                                    <select
                                        className="bg-[#0F1014] border border-white/10 text-white rounded-xl px-4 py-2.5 outline-none focus:border-violet-500 text-sm font-bold"
                                        value={orderFilterStatus}
                                        onChange={(e) => setOrderFilterStatus(e.target.value)}
                                    >
                                        <option value="all">Todos los estados</option>
                                        {ORDER_STATUSES.map(st => (
                                            <option key={st.id} value={st.id}>{st.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="text-xs text-gray-400 font-bold">
                                    Total: {filteredOrders.length} pedidos encontrados
                                </div>
                            </div>

                            <div className="space-y-4">
                                {filteredOrders.length === 0 ? (
                                    <div className="text-center py-20 bg-[#1A1F2E] rounded-2xl border border-dashed border-white/10">
                                        <span className="material-symbols-outlined text-gray-500 text-4xl">inventory_2</span>
                                        <p className="text-gray-400 font-medium mt-2">No se registran pedidos en este estado.</p>
                                    </div>
                                ) : filteredOrders.map(o => {
                                    const metaStatus = ORDER_STATUSES.find(x => x.id === o.status) || ORDER_STATUSES[0];
                                    return (
                                        <div key={o.id} className="bg-[#1A1F2E] p-5 rounded-[20px] border border-white/5 hover:border-white/10 transition-all">
                                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4 border-b border-white/5 pb-4">
                                                <div>
                                                    <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest font-mono">ID ORDEN: {o.id.slice(0, 8)}</span>
                                                    <h4 className="font-extrabold text-white text-base mt-0.5">Tienda: {o.stores?.name || 'Tienda Desconocida'}</h4>
                                                    <p className="text-xs text-gray-400">Cliente: {o.profiles?.full_name || 'Desconocido'} ({o.profiles?.phone || '—'})</p>
                                                </div>

                                                <div className="flex gap-2 flex-wrap items-center">
                                                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-black border uppercase tracking-wider ${metaStatus.color}`}>
                                                        {metaStatus.label}
                                                    </span>
                                                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-black border uppercase ${
                                                        o.payment_status === 'PAID' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                                    }`}>
                                                        Pago: {o.payment_status}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Detalles y montos */}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4 text-xs font-medium text-gray-400">
                                                <div>
                                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Productos adquiridos</p>
                                                    <ul className="space-y-1 bg-[#0F1014]/40 p-3 rounded-xl border border-white/5">
                                                        {(o.items || []).map((it, idx) => (
                                                            <li key={idx} className="text-white flex justify-between">
                                                                <span>{it.name} x{it.quantity}</span>
                                                                <span className="font-mono">${(Number(it.price) * it.quantity).toFixed(2)}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                <div>
                                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Dirección de despacho</p>
                                                    <div className="bg-[#0F1014]/40 p-3 rounded-xl border border-white/5 min-h-[58px] leading-tight">
                                                        {o.delivery_address}
                                                    </div>
                                                </div>

                                                <div>
                                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-1 font-mono">Desglose de Pago</p>
                                                    <div className="bg-[#0F1014]/40 p-3 rounded-xl border border-white/5 space-y-1 font-mono">
                                                        <div className="flex justify-between">
                                                            <span>Monto Productos:</span>
                                                            <span className="text-white">${(Number(o.total) - Number(o.delivery_fee)).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span>Envío (Higo Driver):</span>
                                                            <span className="text-white">${Number(o.delivery_fee).toFixed(2)}</span>
                                                        </div>
                                                        <div className="flex justify-between border-t border-white/5 pt-1 font-extrabold text-sm text-violet-400">
                                                            <span>Total Transacción:</span>
                                                            <span>${Number(o.total).toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Acciones de Emergencia (Sprint 3 & 4) */}
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-white/5 pt-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="material-symbols-outlined text-[18px] text-gray-500">directions_run</span>
                                                    <span className="text-xs text-gray-400 font-bold">
                                                        Driver Asignado: {drivers.find(d => d.id === o.driver_id)?.full_name || <span className="text-yellow-500 italic">Ninguno</span>}
                                                    </span>
                                                </div>

                                                <div className="flex gap-2 flex-wrap justify-end">
                                                    {/* Asignación de conductor */}
                                                    <select
                                                        className="bg-[#0F1014] border border-white/10 text-white rounded-lg px-3 py-1.5 outline-none focus:border-violet-500 text-xs font-bold"
                                                        value={o.driver_id || ''}
                                                        onChange={(e) => handleAssignEmergencyDriver(o.id, e.target.value, e.target.options[e.target.selectedIndex].text)}
                                                    >
                                                        <option value="">-- Conductor de Contingencia --</option>
                                                        {drivers.map(d => (
                                                            <option key={d.id} value={d.id}>{d.full_name}</option>
                                                        ))}
                                                    </select>

                                                    {/* Cambio de estado manual */}
                                                    <select
                                                        className="bg-[#0F1014] border border-white/10 text-white rounded-lg px-3 py-1.5 outline-none focus:border-violet-500 text-xs font-bold"
                                                        value={o.status}
                                                        onChange={(e) => handleForceOrderStatus(o.id, e.target.value)}
                                                    >
                                                        <option value="" disabled>-- Forzar Estado --</option>
                                                        {ORDER_STATUSES.map(st => (
                                                            <option key={st.id} value={st.id}>{st.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ==========================================
                        SECCIÓN ANALÍTICAS / INGRESOS
                        ========================================== */}
                    {activeTab === 'analytics' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                                    <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">Órdenes Completadas</p>
                                    <p className="text-3xl font-extrabold text-white">{shopMetrics.completedCount}</p>
                                    <p className="text-[10px] text-gray-500 mt-1 font-bold">Estado: DELIVERED</p>
                                </div>
                                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                                    <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">Volumen Bruto Venta</p>
                                    <p className="text-3xl font-extrabold text-violet-400">${shopMetrics.grossVolume.toFixed(2)}</p>
                                    <p className="text-[10px] text-gray-500 mt-1 font-bold">Productos + Envíos</p>
                                </div>
                                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                                    <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">Ticket Promedio</p>
                                    <p className="text-3xl font-extrabold text-sky-400">${shopMetrics.ticketAverage.toFixed(2)}</p>
                                    <p className="text-[10px] text-gray-500 mt-1 font-bold">Por orden de compra</p>
                                </div>
                                <div className="bg-[#1A1F2E] rounded-2xl border border-white/5 p-5">
                                    <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">Órdenes Activas</p>
                                    <p className="text-3xl font-extrabold text-yellow-500">{shopMetrics.activeOrdersCount}</p>
                                    <p className="text-[10px] text-gray-500 mt-1 font-bold">En proceso de entrega</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-[#1A1F2E] p-6 rounded-[24px] border border-white/5 md:col-span-2">
                                    <h3 className="font-extrabold text-base mb-4 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-violet-400">payments</span>
                                        Desglose de Facturación
                                    </h3>
                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between text-xs text-gray-400 mb-1 font-bold">
                                                <span>Ganancia de Comercios (Arepas, Pizzas, etc.):</span>
                                                <span className="text-white">${shopMetrics.productVolume.toFixed(2)}</span>
                                            </div>
                                            <div className="w-full bg-[#0F1014] h-2 rounded-full overflow-hidden">
                                                <div 
                                                    className="bg-violet-600 h-full rounded-full" 
                                                    style={{ width: `${shopMetrics.grossVolume > 0 ? (shopMetrics.productVolume / shopMetrics.grossVolume) * 100 : 0}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs text-gray-400 mb-1 font-bold">
                                                <span>Pago a Higo Drivers (Gastos de Envíos):</span>
                                                <span className="text-white">${shopMetrics.deliveryVolume.toFixed(2)}</span>
                                            </div>
                                            <div className="w-full bg-[#0F1014] h-2 rounded-full overflow-hidden">
                                                <div 
                                                    className="bg-sky-500 h-full rounded-full" 
                                                    style={{ width: `${shopMetrics.grossVolume > 0 ? (shopMetrics.deliveryVolume / shopMetrics.grossVolume) * 100 : 0}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#1A1F2E] p-6 rounded-[24px] border border-white/5">
                                    <h3 className="font-extrabold text-base mb-4 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-yellow-500 animate-pulse">leaderboard</span>
                                        Comercios Líderes
                                    </h3>
                                    <div className="space-y-3">
                                        {shopMetrics.leaderSorted.length === 0 ? (
                                            <p className="text-xs text-gray-500 text-center py-10 font-medium">Sin datos de facturación acumulada.</p>
                                        ) : shopMetrics.leaderSorted.map(([storeName, amount], idx) => (
                                            <div key={idx} className="flex justify-between items-center bg-[#0F1014]/50 px-4 py-2.5 rounded-xl border border-white/5">
                                                <span className="text-xs font-bold text-gray-300">{idx + 1}. {storeName}</span>
                                                <span className="text-xs font-black text-white font-mono">${amount.toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ==========================================
                MODAL FORMULARIO COMERCIO
                ========================================== */}
            {showStoreModal && (
                <div className="fixed inset-0 z-50 bg-[#0F1014]/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#1A1F2E] w-full max-w-xl rounded-[28px] border border-white/10 max-h-[90vh] overflow-y-auto p-6 md:p-8 relative">
                        <button
                            onClick={() => setShowStoreModal(false)}
                            className="absolute right-6 top-6 text-gray-400 hover:text-white"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>

                        <h2 className="text-xl font-black mb-6 flex items-center gap-2">
                            <span className="material-symbols-outlined text-violet-500">storefront</span>
                            {editingStore ? 'Modificar Comercio' : 'Registrar Nuevo Comercio'}
                        </h2>

                        <form onSubmit={handleSaveStore} className="space-y-4 text-sm font-semibold">
                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">Nombre del Comercio *</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ej. Arepera Caracas"
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                    value={storeForm.name}
                                    onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Categoría *</label>
                                    <select
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white font-bold"
                                        value={storeForm.category}
                                        onChange={(e) => setStoreForm({ ...storeForm, category: e.target.value })}
                                    >
                                        {STORE_CATEGORIES.map(c => (
                                            <option key={c.id} value={c.id}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Propietario (Merchant ID)</label>
                                    <select
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white font-bold"
                                        value={storeForm.owner_id}
                                        onChange={(e) => setStoreForm({ ...storeForm, owner_id: e.target.value })}
                                    >
                                        <option value="">Sin propietario asignado</option>
                                        {merchants.map(m => (
                                            <option key={m.id} value={m.id}>{m.full_name || m.phone} ({m.role.toUpperCase()})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Teléfono *</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Ej. +584121234567"
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                        value={storeForm.phone}
                                        onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Horas de apertura</label>
                                    <input
                                        type="text"
                                        placeholder="Ej. 8:00 AM - 10:00 PM"
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                        value={storeForm.open_hours}
                                        onChange={(e) => setStoreForm({ ...storeForm, open_hours: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">Dirección Física del Local *</label>
                                <textarea
                                    required
                                    placeholder="Ej. Calle Este 2, Edificio Higo, Higuerote"
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white h-20 resize-none"
                                    value={storeForm.address}
                                    onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })}
                                />
                            </div>

                            {/* PAGO MOVIL DEL COMERCIO */}
                            <div className="border-t border-white/5 pt-4 mt-2">
                                <h4 className="font-extrabold text-sm text-gray-300 mb-3 flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-[18px] text-violet-400 font-black">payments</span>
                                    Datos de Recepción Pago Móvil Banesco
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[11px] text-gray-500 font-bold mb-1.5">Teléfono Pago Móvil</label>
                                        <input
                                            type="text"
                                            placeholder="Ej. 04121234567"
                                            className="w-full px-4 py-2.5 bg-[#0F1014] border border-white/10 rounded-lg outline-none focus:border-violet-500 text-white"
                                            value={storeForm.pago_movil_phone}
                                            onChange={(e) => setStoreForm({ ...storeForm, pago_movil_phone: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-gray-500 font-bold mb-1.5">Cédula del Titular</label>
                                        <input
                                            type="text"
                                            placeholder="Ej. V-12345678"
                                            className="w-full px-4 py-2.5 bg-[#0F1014] border border-white/10 rounded-lg outline-none focus:border-violet-500 text-white"
                                            value={storeForm.pago_movil_cedula}
                                            onChange={(e) => setStoreForm({ ...storeForm, pago_movil_cedula: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <label className="block text-[11px] text-gray-500 font-bold mb-1.5">Nombre del Titular</label>
                                        <input
                                            type="text"
                                            placeholder="Ej. Inversiones Higo C.A"
                                            className="w-full px-4 py-2.5 bg-[#0F1014] border border-white/10 rounded-lg outline-none focus:border-violet-500 text-white"
                                            value={storeForm.pago_movil_holder}
                                            onChange={(e) => setStoreForm({ ...storeForm, pago_movil_holder: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-gray-500 font-bold mb-1.5">Banco Destinatario</label>
                                        <select
                                            className="w-full px-4 py-2.5 bg-[#0F1014] border border-white/10 rounded-lg outline-none focus:border-violet-500 text-white font-bold"
                                            value={storeForm.pago_movil_bank}
                                            onChange={(e) => setStoreForm({ ...storeForm, pago_movil_bank: e.target.value })}
                                        >
                                            <option value="0102">Banesco Banco Universal (0102)</option>
                                            <option value="0108">Banco Provincial (0108)</option>
                                            <option value="0105">Banco Mercantil (0105)</option>
                                            <option value="0134">Banesco Simplificado (0134)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-3 justify-end pt-4 border-t border-white/5">
                                <button
                                    type="button"
                                    onClick={() => setShowStoreModal(false)}
                                    className="px-5 py-3 rounded-xl bg-[#0F1014] border border-white/10 hover:bg-white/5 font-bold text-sm text-gray-300"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 font-bold text-sm text-white shadow-lg shadow-violet-600/15"
                                >
                                    Guardar Cambios
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ==========================================
                MODAL FORMULARIO PRODUCTO
                ========================================== */}
            {showProductModal && (
                <div className="fixed inset-0 z-50 bg-[#0F1014]/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#1A1F2E] w-full max-w-md rounded-[28px] border border-white/10 max-h-[90vh] overflow-y-auto p-6 md:p-8 relative">
                        <button
                            onClick={() => setShowProductModal(false)}
                            className="absolute right-6 top-6 text-gray-400 hover:text-white"
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>

                        <h2 className="text-xl font-black mb-6 flex items-center gap-2">
                            <span className="material-symbols-outlined text-violet-500">fastfood</span>
                            {editingProduct ? 'Modificar Producto' : 'Crear Producto Global'}
                        </h2>

                        <form onSubmit={handleSaveProduct} className="space-y-4 text-sm font-semibold">
                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">Comercio Propietario *</label>
                                <select
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white font-bold"
                                    value={productForm.store_id}
                                    onChange={(e) => setProductForm({ ...productForm, store_id: e.target.value })}
                                >
                                    {stores.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">Nombre del Producto *</label>
                                <input
                                    type="text"
                                    required
                                    placeholder="Ej. Arepa Reina Pepiada"
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                    value={productForm.name}
                                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Precio ($ USD) *</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        required
                                        placeholder="Ej. 4.50"
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white font-mono"
                                        value={productForm.price}
                                        onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold mb-1.5">Categoría *</label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Ej. Arepas, Bebidas"
                                        className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                        value={productForm.category}
                                        onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">Descripción Corta</label>
                                <textarea
                                    placeholder="Ej. Arepa rellena de aguacate con pollo mechado y mayonesa."
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white h-16 resize-none"
                                    value={productForm.description}
                                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-gray-400 font-bold mb-1.5">URL de Imagen del Producto</label>
                                <input
                                    type="text"
                                    placeholder="Ej. https://url-de-la-imagen.jpg"
                                    className="w-full px-4 py-3 bg-[#0F1014] border border-white/10 rounded-xl outline-none focus:border-violet-500 text-white"
                                    value={productForm.image_url}
                                    onChange={(e) => setProductForm({ ...productForm, image_url: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-3 bg-[#0F1014]/50 p-4 rounded-xl border border-white/5">
                                <input
                                    type="checkbox"
                                    id="available"
                                    className="w-4 h-4 rounded accent-violet-600 shrink-0"
                                    checked={productForm.available}
                                    onChange={(e) => setProductForm({ ...productForm, available: e.target.checked })}
                                />
                                <label htmlFor="available" className="text-xs text-gray-300 font-bold cursor-pointer">
                                    Marcar como disponible para compra inmediata
                                </label>
                            </div>

                            <div className="flex gap-3 justify-end pt-4 border-t border-white/5">
                                <button
                                    type="button"
                                    onClick={() => setShowProductModal(false)}
                                    className="px-5 py-3 rounded-xl bg-[#0F1014] border border-white/10 hover:bg-white/5 font-bold text-sm text-gray-300"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 font-bold text-sm text-white shadow-lg shadow-violet-600/15"
                                >
                                    Guardar Producto
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
