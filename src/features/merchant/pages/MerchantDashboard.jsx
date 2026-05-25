import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store, ClipboardList, CheckCircle2, AlertCircle, Clock,
  MessageCircle, Send, Check, Search, Filter, ShieldCheck,
  Plus, Trash2, Edit3, Save, X, Settings, TrendingUp,
  DollarSign, ToggleLeft, ToggleRight, Info, Eye
} from 'lucide-react';
import { supabase } from '../../../services/supabase.js';
import { useOrderStore } from '../../../stores/shop/useOrderStore.js';
import { useAuthStore } from '../../../stores/shop/useAuthStore.js';
import { syncOrderStatus } from '../../../services/shopOrderRealtimeService.js';
import { fetchStoreOrdersRemote } from '../../../services/shopOrderService.js';
import { pushOrderEvent } from '../../../services/shopTrackingService.js';
import { formatOrderStatus } from '../../../services/shopOrderStatus.js';
import { useChatStore } from '../../../stores/shop/useChatStore.js';
import { formatCurrency } from '../../../services/shopDeliveryPricing.js';
import { Spinner } from '../../../components/shop/ui/Spinner.jsx';
import { mockStores } from '../../../data/stores.js';
import { mockProducts } from '../../../data/products.js';
import './MerchantDashboard.css';

const reportRealtimeError = (action, error) => {
  console.warn(`[MerchantDashboard] ${action}`, error?.message || error);
};

const STATUS_SECTIONS = [
  { id: 'pending', label: 'Por Validar', icon: '💳', statuses: ['PENDING_PRODUCT_PAYMENT', 'PRODUCT_PAYMENT_REPORTED', 'PENDING_PAYMENT'] },
  { id: 'kitchen', label: 'En Cocina', icon: '👨‍🍳', statuses: ['PRODUCT_PAYMENT_VERIFIED', 'PAYMENT_VERIFIED', 'PREPARING'] },
  { id: 'dispatch', label: 'Despacho', icon: '📦', statuses: ['READY_FOR_DRIVER_MATCH', 'READY_TO_DISPATCH', 'DRIVER_CANDIDATE_BROADCASTED'] },
  { id: 'delivered', label: 'Historial', icon: '🏁', statuses: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE_TO_STORE', 'PICKED_UP', 'DRIVER_EN_ROUTE_TO_CUSTOMER', 'DELIVERY_PAYMENT_PENDING', 'DELIVERY_PAYMENT_REPORTED', 'DELIVERY_PAYMENT_CONFIRMED', 'DELIVERED', 'CANCELLED'] }
];

export function MerchantDashboard() {
  const { orders, updateOrderStatus, assignDriver, upsertRemoteOrder } = useOrderStore();
  const merchantId = useAuthStore((s) => s.userId);
  const { chats, addMessage, initializeChat } = useChatStore();
  
  // Tabs: orders | products | store | income
  const [activeDashboardTab, setActiveDashboardTab] = useState('orders');
  
  // Orders Sub-tab
  const [activeTab, setActiveTab] = useState('pending'); // pending | kitchen | dispatch | delivered
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [chatInputText, setChatInputText] = useState('');

  // Active Store & Products
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoadingStoreData, setIsLoadingStoreData] = useState(true);

  // Product CRUD states
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [newProductForm, setNewProductForm] = useState({
    name: '',
    description: '',
    price: '',
    category: 'Arepas',
    available: true,
    image_url: ''
  });

  // Store edit states
  const [editingStoreFields, setEditingStoreFields] = useState({
    name: '',
    description: '',
    phone: '',
    address: '',
    is_open: true,
    open_hours: '',
    pago_movil_phone: '',
    pago_movil_bank: '',
    pago_movil_cedula: '',
    pago_movil_holder: ''
  });

  // Load Active Store Owned by Merchant from Supabase (falls back to mockStores)
  useEffect(() => {
    if (!merchantId) {
      // Fallback if not authenticated
      setStore(mockStores[0]);
      setProducts(mockProducts[mockStores[0].id] || []);
      setIsLoadingStoreData(false);
      return;
    }

    async function loadStoreDetails() {
      try {
        setIsLoadingStoreData(true);
        // 1. Fetch store owned by active merchant
        const { data: storeData, error: storeError } = await supabase
          .from('stores')
          .select('*')
          .eq('owner_id', merchantId)
          .maybeSingle();

        if (storeError) throw storeError;

        let activeStore = storeData;
        if (!activeStore) {
          // Fallback: If no store owned in Supabase, check if there's any store to use or use mock
          const { data: firstStore } = await supabase.from('stores').select('*').limit(1);
          if (firstStore && firstStore.length > 0) {
            activeStore = firstStore[0];
          } else {
            activeStore = mockStores[0];
          }
        }

        setStore(activeStore);

        // Prepopulate store form
        setEditingStoreFields({
          name: activeStore.name || '',
          description: activeStore.description || '',
          phone: activeStore.phone || '',
          address: activeStore.address || '',
          is_open: activeStore.is_open ?? true,
          open_hours: activeStore.open_hours || '8:00 AM - 10:00 PM',
          pago_movil_phone: activeStore.pago_movil?.phone || '',
          pago_movil_bank: activeStore.pago_movil?.bank || '',
          pago_movil_cedula: activeStore.pago_movil?.cedula || '',
          pago_movil_holder: activeStore.pago_movil?.holder || ''
        });

        // 2. Fetch products for this store
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', activeStore.id)
          .order('created_at', { ascending: false });

        if (productsError) throw productsError;

        if (productsData && productsData.length > 0) {
          setProducts(productsData);
        } else {
          // Fallback to local mocks
          setProducts(mockProducts[activeStore.id] || mockProducts['store-001'] || []);
        }
      } catch (err) {
        console.error("Error loading store data:", err.message);
        // Fallback
        setStore(mockStores[0]);
        setProducts(mockProducts[mockStores[0].id] || []);
      } finally {
        setIsLoadingStoreData(false);
      }
    }

    loadStoreDetails();
  }, [merchantId]);

  // Sync orders with Supabase
  useEffect(() => {
    const activeStoreId = store?.id;
    if (!activeStoreId) return;

    fetchStoreOrdersRemote(activeStoreId)
      .then((rows) => rows.forEach((o) => upsertRemoteOrder(o)))
      .catch((error) => reportRealtimeError("realtime fetch orders failed", error));
  }, [store, upsertRemoteOrder]);

  // Filter orders for active sub-tab
  const activeOrdersForTab = useMemo(() => {
    const section = STATUS_SECTIONS.find(s => s.id === activeTab);
    return orders.filter(o => section.statuses.includes(o.status) && o.storeId === store?.id);
  }, [orders, activeTab, store]);

  // Selected order details
  const selectedOrder = useMemo(() => {
    return orders.find(o => o.id === selectedOrderId && o.storeId === store?.id) || activeOrdersForTab[0] || null;
  }, [orders, selectedOrderId, activeOrdersForTab, store]);

  // Sync selectedOrderId when changing tabs
  useEffect(() => {
    if (activeOrdersForTab.length > 0) {
      setSelectedOrderId(activeOrdersForTab[0].id);
    } else {
      setSelectedOrderId(null);
    }
  }, [activeTab]);

  const orderChat = useMemo(() => {
    if (!selectedOrder) return { storeMessages: [] };
    initializeChat(selectedOrder.id);
    return chats[selectedOrder.id] || { storeMessages: [] };
  }, [selectedOrder, chats]);

  // Handles chat message submission
  const handleSendMerchantMessage = (e) => {
    e.preventDefault();
    if (!chatInputText.trim() || !selectedOrder) return;

    addMessage(selectedOrder.id, 'storeMessages', {
      sender: 'store',
      text: chatInputText
    });
    setChatInputText('');
  };

  // Simulates Driver assignment upon dispatch (Sprint 4 Audit Trail logging included)
  const handleDispatchOrder = (orderId) => {
    updateOrderStatus(orderId, 'READY_FOR_DRIVER_MATCH');
    syncOrderStatus(orderId, 'READY_FOR_DRIVER_MATCH').catch((error) => reportRealtimeError("realtime action failed", error));
    
    // Log audit trail event in database
    pushOrderEvent({
      orderId,
      eventType: 'READY_FOR_DRIVER_MATCH',
      actorType: 'merchant',
      actorId: merchantId || 'merchant-demo',
      payload: { note: 'El comercio ha empacado el pedido y busca driver.', source: 'merchant_dashboard' }
    }).catch((error) => reportRealtimeError("logging event failed", error));
    
    addMessage(orderId, 'storeMessages', {
      sender: 'store',
      text: '📦 Pedido empacado y listo. Buscando motorizado en la zona...'
    });

    // Simulate driver matching in 4 seconds
    setTimeout(() => {
      updateOrderStatus(orderId, 'DRIVER_CANDIDATE_BROADCASTED');
      syncOrderStatus(orderId, 'DRIVER_CANDIDATE_BROADCASTED').catch((error) => reportRealtimeError("realtime action failed", error));
      
      pushOrderEvent({
        orderId,
        eventType: 'DRIVER_CANDIDATE_BROADCASTED',
        actorType: 'system',
        actorId: 'system',
        payload: { broadcastRange: '5km' }
      }).catch((error) => reportRealtimeError("logging event failed", error));

      assignDriver(orderId, merchantId || 'driver-demo');
      syncOrderStatus(orderId, 'DRIVER_ASSIGNED', merchantId || 'driver-demo').catch((error) => reportRealtimeError("realtime action failed", error));
      
      pushOrderEvent({
        orderId,
        eventType: 'DRIVER_ASSIGNED',
        actorType: 'system',
        actorId: merchantId || 'system-assigner',
        payload: { driverName: 'Carlos Mendoza', vehicle: 'Moto' }
      }).catch((error) => reportRealtimeError("logging event failed", error));
      
      addMessage(orderId, 'driverMessages', {
        sender: 'driver',
        text: '🛵 Higo Driver asignado al despacho.',
        system: true
      });

      addMessage(orderId, 'driverMessages', {
        sender: 'driver',
        text: '¡Buenas noches! Soy tu Higo Driver. Ya voy saliendo a retirar el pedido.'
      });

      addMessage(orderId, 'storeMessages', {
        sender: 'store',
        text: '🛵 Un Higo Driver ha sido asignado y va en camino a retirar.'
      });
    }, 4000);
  };

  // ==========================================
  // SPRINT 3: PRODUCT CRUD OPERATIONS
  // ==========================================
  const handleSaveProduct = async (e) => {
    e.preventDefault();
    if (!newProductForm.name || !newProductForm.price) {
      alert("Por favor rellena el nombre y precio del producto.");
      return;
    }

    try {
      const priceVal = parseFloat(newProductForm.price);
      const productPayload = {
        store_id: store.id,
        name: newProductForm.name,
        description: newProductForm.description,
        price: priceVal,
        category: newProductForm.category,
        available: newProductForm.available,
        image_url: newProductForm.image_url || null
      };

      if (editingProduct) {
        // Update in Supabase
        const { data, error } = await supabase
          .from('products')
          .update(productPayload)
          .eq('id', editingProduct.id)
          .select()
          .single();

        if (error) throw error;
        setProducts(products.map(p => p.id === editingProduct.id ? data : p));
        alert("¡Producto actualizado con éxito!");
      } else {
        // Insert in Supabase
        const { data, error } = await supabase
          .from('products')
          .insert([productPayload])
          .select()
          .single();

        if (error) throw error;
        setProducts([data, ...products]);
        alert("¡Producto agregado con éxito!");
      }

      // Close modal & reset form
      setShowAddProductModal(false);
      setEditingProduct(null);
      setNewProductForm({
        name: '',
        description: '',
        price: '',
        category: 'Arepas',
        available: true,
        image_url: ''
      });
    } catch (err) {
      console.error("Error writing product data to Supabase:", err.message);
      // Fallback local mock simulation
      const mockId = editingProduct?.id || `product-mock-${Date.now()}`;
      const mappedMock = {
        id: mockId,
        storeId: store.id,
        name: newProductForm.name,
        description: newProductForm.description,
        price: parseFloat(newProductForm.price),
        category: newProductForm.category,
        available: newProductForm.available,
        imageUrl: newProductForm.image_url || null
      };

      if (editingProduct) {
        setProducts(products.map(p => p.id === editingProduct.id ? mappedMock : p));
      } else {
        setProducts([mappedMock, ...products]);
      }
      setShowAddProductModal(false);
      setEditingProduct(null);
    }
  };

  const handleEditProductClick = (product) => {
    setEditingProduct(product);
    setNewProductForm({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      category: product.category,
      available: product.available ?? true,
      image_url: product.image_url || product.imageUrl || ''
    });
    setShowAddProductModal(true);
  };

  const handleDeleteProduct = async (productId) => {
    if (!confirm("¿Estás seguro de eliminar este producto del catálogo?")) return;

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId);

      if (error) throw error;
      setProducts(products.filter(p => p.id !== productId));
    } catch (err) {
      console.error("Error deleting product from Supabase:", err.message);
      // Local fallback simulation
      setProducts(products.filter(p => p.id !== productId));
    }
  };

  // ==========================================
  // SPRINT 3: MY STORE SETTINGS
  // ==========================================
  const handleSaveStoreSettings = async (e) => {
    e.preventDefault();
    if (!editingStoreFields.name || !editingStoreFields.phone) {
      alert("Por favor completa los campos requeridos de la tienda.");
      return;
    }

    try {
      const storePayload = {
        name: editingStoreFields.name,
        description: editingStoreFields.description,
        phone: editingStoreFields.phone,
        address: editingStoreFields.address,
        is_open: editingStoreFields.is_open,
        open_hours: editingStoreFields.open_hours,
        pago_movil: {
          phone: editingStoreFields.pago_movil_phone,
          bank: editingStoreFields.pago_movil_bank,
          cedula: editingStoreFields.pago_movil_cedula,
          holder: editingStoreFields.pago_movil_holder
        }
      };

      const { data, error } = await supabase
        .from('stores')
        .update(storePayload)
        .eq('id', store.id)
        .select()
        .single();

      if (error) throw error;
      setStore(data);
      alert("¡Parámetros de la tienda guardados con éxito!");
    } catch (err) {
      console.error("Error updating store in Supabase:", err.message);
      // Local mock simulation fallback
      setStore({
        ...store,
        name: editingStoreFields.name,
        description: editingStoreFields.description,
        phone: editingStoreFields.phone,
        address: editingStoreFields.address,
        isOpen: editingStoreFields.is_open,
        openHours: editingStoreFields.open_hours,
        pagoMovil: {
          phone: editingStoreFields.pago_movil_phone,
          bank: editingStoreFields.pago_movil_bank,
          cedula: editingStoreFields.pago_movil_cedula,
          holder: editingStoreFields.pago_movil_holder
        }
      });
      alert("Parámetros guardados localmente en caché.");
    }
  };

  const handleToggleStoreStatus = async () => {
    const nextStatus = !editingStoreFields.is_open;
    setEditingStoreFields(prev => ({ ...prev, is_open: nextStatus }));
    
    try {
      const { data, error } = await supabase
        .from('stores')
        .update({ is_open: nextStatus })
        .eq('id', store.id)
        .select()
        .single();

      if (error) throw error;
      setStore(data);
    } catch (err) {
      console.error("Error toggling store status:", err.message);
      setStore(prev => ({ ...prev, isOpen: nextStatus }));
    }
  };

  // ==========================================
  // SPRINT 3: INCOME METRICS
  // ==========================================
  const incomeMetrics = useMemo(() => {
    // Filter delivered store orders
    const completedOrders = orders.filter(o => o.status === 'DELIVERED' && o.storeId === store?.id);
    const totalEarnings = completedOrders.reduce((sum, o) => sum + (o.productTotal || 0), 0);
    const totalOrdersCount = completedOrders.length;
    const avgOrderValue = totalOrdersCount > 0 ? totalEarnings / totalOrdersCount : 0;

    return {
      totalEarnings,
      totalOrdersCount,
      avgOrderValue,
      transactions: completedOrders
    };
  }, [orders, store]);


  if (isLoadingStoreData) {
    return (
      <div className="merchant-dashboard-loading">
        <Spinner size="lg" />
        <p>Cargando información del comercio...</p>
      </div>
    );
  }

  return (
    <div className="merchant-dashboard animate-fade-in">
      {/* 1. TOP HEADER BANNER & CENTRAL NAVIGATION */}
      <div className="merchant-hero-header">
        <div className="merchant-hero-header__logo">
          <Store size={22} />
        </div>
        <div className="merchant-hero-header__details">
          <h1>Panel de Control de Comercio</h1>
          <span className="merchant-hero-header__store">
            Comercio Activo: <strong>{store?.name || 'Arepera La Reina'}</strong>
            <span className={`store-status-badge ${store?.isOpen || store?.is_open ? 'open' : 'closed'}`}>
              {store?.isOpen || store?.is_open ? '● ABIERTO' : '● CERRADO'}
            </span>
          </span>
        </div>
      </div>

      {/* MODULAR ROADMAP TABS (Sprint 3 navigation shell) */}
      <div className="merchant-navigation-tabs">
        <button
          className={`merchant-nav-tab ${activeDashboardTab === 'orders' ? 'active' : ''}`}
          onClick={() => setActiveDashboardTab('orders')}
        >
          <ClipboardList size={18} />
          <span>Pedidos</span>
        </button>
        <button
          className={`merchant-nav-tab ${activeDashboardTab === 'products' ? 'active' : ''}`}
          onClick={() => setActiveDashboardTab('products')}
        >
          <Store size={18} />
          <span>Productos</span>
        </button>
        <button
          className={`merchant-nav-tab ${activeDashboardTab === 'store' ? 'active' : ''}`}
          onClick={() => setActiveDashboardTab('store')}
        >
          <Settings size={18} />
          <span>Mi Tienda</span>
        </button>
        <button
          className={`merchant-nav-tab ${activeDashboardTab === 'income' ? 'active' : ''}`}
          onClick={() => setActiveDashboardTab('income')}
        >
          <TrendingUp size={18} />
          <span>Ingresos</span>
        </button>
      </div>

      {/* 2. DYNAMIC TAB RENDER */}
      <div className="merchant-tab-content">
        
        {/* ==========================================
            TAB: ORDERS
            ========================================== */}
        {activeDashboardTab === 'orders' && (
          <div className="tab-pane-orders animate-fade-in">
            {/* Dynamic Workflow sub-tabs */}
            <div className="merchant-workflow-tabs">
              {STATUS_SECTIONS.map(sec => {
                const count = orders.filter(o => sec.statuses.includes(o.status) && o.storeId === store?.id).length;
                return (
                  <button
                    key={sec.id}
                    className={`merchant-workflow-tab ${activeTab === sec.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(sec.id)}
                  >
                    <span className="tab-icon">{sec.icon}</span>
                    <span className="tab-label">{sec.label}</span>
                    {count > 0 && <span className="tab-badge">{count}</span>}
                  </button>
                );
              })}
            </div>

            {/* Split layout pane */}
            <div className="merchant-layout-split">
              <div className="merchant-orders-pane">
                {activeOrdersForTab.length === 0 ? (
                  <div className="merchant-empty-pane">
                    <ClipboardList size={36} strokeWidth={1.5} color="var(--higo-gray-300)" />
                    <p>Sin órdenes en este estado</p>
                  </div>
                ) : (
                  <div className="merchant-orders-list">
                    {activeOrdersForTab.map(o => (
                      <div
                        key={o.id}
                        className={`merchant-order-item ${selectedOrder?.id === o.id ? 'selected' : ''}`}
                        onClick={() => setSelectedOrderId(o.id)}
                      >
                        <div className="merchant-order-item__header">
                          <span className="order-id">Ref: {o.id.slice(0, 8)}...</span>
                          <span className="order-time">
                            {new Date(o.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="merchant-order-item__desc">
                          {o.items.map(item => `${item.name} x${item.quantity}`).join(', ')}
                        </div>
                        <div className="merchant-order-item__footer">
                          <span className="payment-method">
                            {o.payment_method === 'cash' ? '💵 Efectivo' : '📱 Pago Móvil'}
                          </span>
                          <span className="order-total">{formatCurrency(o.productTotal)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Detail pane */}
              <div className="merchant-details-pane">
                {selectedOrder ? (
                  <div className="merchant-details-content">
                    <div className="details-header">
                      <div>
                        <h3>Orden {selectedOrder.id}</h3>
                        <span className="details-address">{selectedOrder.deliveryAddress}</span>
                      </div>
                      <div className="details-price">{formatCurrency(selectedOrder.productTotal)}</div>
                    </div>

                    <div className="details-action-block">
                      <div className="details-action-block__status">
                        <span>Estado:</span>
                        <strong>{formatOrderStatus(selectedOrder.status)}</strong>
                      </div>

                      <div className="details-action-block__buttons">
                        {(selectedOrder.status === 'PENDING_PAYMENT' || selectedOrder.status === 'PENDING_PRODUCT_PAYMENT' || selectedOrder.status === 'PRODUCT_PAYMENT_REPORTED') && (
                          <button
                            className="action-btn action-btn--success"
                            onClick={() => {
                              updateOrderStatus(selectedOrder.id, 'PRODUCT_PAYMENT_VERIFIED');
                              syncOrderStatus(selectedOrder.id, 'PRODUCT_PAYMENT_VERIFIED').catch((error) => reportRealtimeError("realtime action failed", error));
                              pushOrderEvent({
                                orderId: selectedOrder.id,
                                eventType: 'PRODUCT_PAYMENT_VERIFIED',
                                actorType: 'merchant',
                                actorId: merchantId || 'merchant-demo',
                                payload: { note: 'El comercio verificó el pago móvil de los productos.', source: 'merchant_dashboard' }
                              }).catch((error) => reportRealtimeError("logging event failed", error));
                            }}
                          >
                            <CheckCircle2 size={16} />
                            Confirmar Pago Recibido
                          </button>
                        )}

                        {(selectedOrder.status === 'PAYMENT_VERIFIED' || selectedOrder.status === 'PRODUCT_PAYMENT_VERIFIED') && (
                          <button
                            className="action-btn action-btn--primary"
                            onClick={() => {
                              updateOrderStatus(selectedOrder.id, 'PREPARING');
                              syncOrderStatus(selectedOrder.id, 'PREPARING').catch((error) => reportRealtimeError("realtime action failed", error));
                              pushOrderEvent({
                                orderId: selectedOrder.id,
                                eventType: 'PREPARING',
                                actorType: 'merchant',
                                actorId: merchantId || 'merchant-demo',
                                payload: { note: 'Comercio inicia la preparación de los productos.', source: 'merchant_dashboard' }
                              }).catch((error) => reportRealtimeError("logging event failed", error));
                            }}
                          >
                            👨‍🍳 Iniciar Preparación
                          </button>
                        )}

                        {selectedOrder.status === 'PREPARING' && (
                          <button
                            className="action-btn action-btn--success"
                            onClick={() => handleDispatchOrder(selectedOrder.id)}
                          >
                            📦 Despachar a Higo Driver
                          </button>
                        )}

                        {(selectedOrder.status === 'READY_TO_DISPATCH' || selectedOrder.status === 'READY_FOR_DRIVER_MATCH' || selectedOrder.status === 'DRIVER_CANDIDATE_BROADCASTED') && (
                          <div className="merchant-searching-driver">
                            <Spinner size="sm" />
                            <span>Buscando Higo Driver disponible...</span>
                          </div>
                        )}

                        {selectedOrder.status === 'DRIVER_ASSIGNED' && (
                          <div className="merchant-assigned-driver">
                            <span className="icon">🛵</span>
                            <span>Higo Driver <strong>Carlos Mendoza</strong> va al local a retirar</span>
                          </div>
                        )}

                        {(selectedOrder.status === 'PICKED_UP' || selectedOrder.status === 'DRIVER_EN_ROUTE_TO_CUSTOMER' || selectedOrder.status === 'DELIVERY_PAYMENT_PENDING' || selectedOrder.status === 'DELIVERY_PAYMENT_REPORTED' || selectedOrder.status === 'DELIVERY_PAYMENT_CONFIRMED') && (
                          <div className="merchant-assigned-driver">
                            <span className="icon">🚀</span>
                            <span>En tránsito — Driver lleva el pedido al cliente</span>
                          </div>
                        )}

                        {selectedOrder.status === 'DELIVERED' && (
                          <div className="merchant-success-status">
                            <ShieldCheck size={18} />
                            <span>Pedido Entregado con éxito</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="details-items-section">
                      <h4>Productos Solicitados</h4>
                      <div className="details-items-list">
                        {selectedOrder.items.map(item => (
                          <div key={item.id} className="details-item-row">
                            <span>{item.name} <strong style={{ color: 'var(--higo-blue)' }}>x{item.quantity}</strong></span>
                            <span>{formatCurrency(item.price * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Chat box */}
                    <div className="details-chat-section">
                      <h4>Chat con el Cliente</h4>
                      <div className="details-chat-box">
                        {orderChat.storeMessages.map(msg => {
                          const isMe = msg.sender === 'store';
                          return (
                            <div key={msg.id} className={`merchant-chat-bubble-wrapper ${isMe ? 'me' : 'other'}`}>
                              <div className={`merchant-chat-bubble ${isMe ? 'me' : 'other'}`}>
                                {msg.image ? (
                                  <div className="merchant-chat-attachment">
                                    <img src={msg.image} alt="Capture de pago" />
                                    <span>{msg.text}</span>
                                  </div>
                                ) : (
                                  <p>{msg.text}</p>
                                )}
                                <span className="timestamp">
                                  {new Date(msg.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <form className="details-chat-form" onSubmit={handleSendMerchantMessage}>
                        <input
                          type="text"
                          placeholder="Escribe al cliente..."
                          value={chatInputText}
                          onChange={(e) => setChatInputText(e.target.value)}
                        />
                        <button type="submit" disabled={!chatInputText.trim()}>
                          <Send size={15} />
                        </button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <div className="merchant-empty-pane" style={{ height: '100%' }}>
                    <Store size={48} strokeWidth={1} color="var(--higo-gray-200)" />
                    <h3>Selecciona un pedido</h3>
                    <p>Selecciona una orden del panel izquierdo para ver los detalles e interactuar.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
            TAB: PRODUCTS (Sprint 3: CRUD)
            ========================================== */}
        {activeDashboardTab === 'products' && (
          <div className="tab-pane-products animate-fade-in">
            <div className="tab-pane-products__header">
              <h2>Catálogo de Productos ({products.length})</h2>
              <button 
                className="add-product-btn-main"
                onClick={() => { setEditingProduct(null); setShowAddProductModal(true); }}
              >
                <Plus size={16} />
                <span>Agregar Producto</span>
              </button>
            </div>

            {products.length === 0 ? (
              <div className="merchant-empty-pane shadow-sm">
                <Store size={48} strokeWidth={1.5} color="var(--higo-gray-300)" />
                <h3>Tu catálogo está vacío</h3>
                <p>Agrega tu primer producto para comenzar a vender en Higo Shop.</p>
              </div>
            ) : (
              <div className="merchant-products-grid">
                {products.map(p => (
                  <div key={p.id} className="merchant-product-card shadow-sm">
                    <div className={`product-card-image-box product-card-image-box--${store?.category || 'restaurant'}`}>
                      {p.imageUrl || p.image_url ? (
                        <img src={p.imageUrl || p.image_url} alt={p.name} />
                      ) : (
                        <span className="emoji-ph">
                          {store?.category === 'restaurant' ? '🍔' : store?.category === 'pharmacy' ? '💊' : store?.category === 'bakery' ? '🥐' : '🛒'}
                        </span>
                      )}
                    </div>
                    
                    <div className="product-card-body">
                      <div className="product-title-price">
                        <h3>{p.name}</h3>
                        <span className="price">{formatCurrency(p.price)}</span>
                      </div>
                      <p className="desc">{p.description || 'Sin descripción'}</p>
                      
                      <div className="product-card-footer">
                        <span className={`product-status-tag ${p.available ? 'in-stock' : 'out-of-stock'}`}>
                          {p.available ? 'Disponible' : 'Agotado'}
                        </span>
                        
                        <div className="product-card-actions">
                          <button 
                            className="p-btn edit" 
                            onClick={() => handleEditProductClick(p)}
                            title="Editar"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button 
                            className="p-btn delete" 
                            onClick={() => handleDeleteProduct(p.id)}
                            title="Eliminar"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* PRODUCT ADD/EDIT MODAL */}
            {showAddProductModal && (
              <div className="product-modal-overlay">
                <div className="product-modal-content animate-fade-in-up">
                  <div className="product-modal-header">
                    <h3>{editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}</h3>
                    <button className="close-btn" onClick={() => setShowAddProductModal(false)}>
                      <X size={18} />
                    </button>
                  </div>

                  <form className="product-modal-form" onSubmit={handleSaveProduct}>
                    <div className="form-group">
                      <label>Nombre del Producto *</label>
                      <input 
                        type="text" 
                        required
                        value={newProductForm.name}
                        onChange={e => setNewProductForm({...newProductForm, name: e.target.value})}
                        placeholder="Ej. Arepa Reina Pepiada"
                      />
                    </div>

                    <div className="form-row-2">
                      <div className="form-group">
                        <label>Precio (Bs.) *</label>
                        <input 
                          type="number" 
                          step="0.01"
                          required
                          value={newProductForm.price}
                          onChange={e => setNewProductForm({...newProductForm, price: e.target.value})}
                          placeholder="Ej. 180.50"
                        />
                      </div>
                      <div className="form-group">
                        <label>Categoría</label>
                        <select 
                          value={newProductForm.category}
                          onChange={e => setNewProductForm({...newProductForm, category: e.target.value})}
                        >
                          <option value="Arepas">Arepas</option>
                          <option value="Bebidas">Bebidas</option>
                          <option value="Entradas">Entradas</option>
                          <option value="Medicinas">Medicinas</option>
                          <option value="Postres">Postres</option>
                          <option value="Víveres">Víveres</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Descripción del Producto</label>
                      <textarea 
                        value={newProductForm.description}
                        onChange={e => setNewProductForm({...newProductForm, description: e.target.value})}
                        placeholder="Describe los ingredientes, tamaño o detalles del producto..."
                        rows="3"
                      />
                    </div>

                    <div className="form-group">
                      <label>Enlace de Imagen (URL opcional)</label>
                      <input 
                        type="text" 
                        value={newProductForm.image_url}
                        onChange={e => setNewProductForm({...newProductForm, image_url: e.target.value})}
                        placeholder="https://images.unsplash.com/..."
                      />
                    </div>

                    <div className="form-group-checkbox">
                      <input 
                        type="checkbox" 
                        id="prod-available"
                        checked={newProductForm.available}
                        onChange={e => setNewProductForm({...newProductForm, available: e.target.checked})}
                      />
                      <label htmlFor="prod-available">Producto disponible para la venta</label>
                    </div>

                    <div className="form-actions-row">
                      <button 
                        type="button" 
                        className="modal-btn cancel"
                        onClick={() => setShowAddProductModal(false)}
                      >
                        Cancelar
                      </button>
                      <button type="submit" className="modal-btn submit">
                        <Save size={16} />
                        Guardar Producto
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==========================================
            TAB: STORE SETTINGS (Sprint 3: Store Configuration)
            ========================================== */}
        {activeDashboardTab === 'store' && (
          <div className="tab-pane-store animate-fade-in">
            <div className="store-settings-container shadow-sm">
              <div className="store-settings-header">
                <h2>Ajustes y Configuración de Tienda</h2>
                <div className="store-status-controller">
                  <span>Estado:</span>
                  <button 
                    className={`status-toggle-btn ${editingStoreFields.is_open ? 'open' : 'closed'}`}
                    onClick={handleToggleStoreStatus}
                    type="button"
                  >
                    {editingStoreFields.is_open ? <ToggleRight size={38} /> : <ToggleLeft size={38} />}
                    <span>{editingStoreFields.is_open ? 'ABIERTO' : 'CERRADO'}</span>
                  </button>
                </div>
              </div>

              <form className="store-settings-form" onSubmit={handleSaveStoreSettings}>
                {/* General data */}
                <div className="form-section">
                  <h3>📝 Datos Generales</h3>
                  
                  <div className="form-group">
                    <label>Nombre del Comercio *</label>
                    <input 
                      type="text" 
                      required
                      value={editingStoreFields.name}
                      onChange={e => setEditingStoreFields({...editingStoreFields, name: e.target.value})}
                    />
                  </div>

                  <div className="form-group">
                    <label>Descripción corta</label>
                    <textarea 
                      value={editingStoreFields.description}
                      onChange={e => setEditingStoreFields({...editingStoreFields, description: e.target.value})}
                      rows="2"
                    />
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Teléfono de Contacto *</label>
                      <input 
                        type="text" 
                        required
                        value={editingStoreFields.phone}
                        onChange={e => setEditingStoreFields({...editingStoreFields, phone: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Horario de Apertura</label>
                      <input 
                        type="text" 
                        value={editingStoreFields.open_hours}
                        onChange={e => setEditingStoreFields({...editingStoreFields, open_hours: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Dirección Física *</label>
                    <input 
                      type="text" 
                      required
                      value={editingStoreFields.address}
                      onChange={e => setEditingStoreFields({...editingStoreFields, address: e.target.value})}
                    />
                  </div>
                </div>

                {/* Pago Movil settings */}
                <div className="form-section">
                  <h3>📱 Coordenadas de Pago Móvil</h3>
                  <p className="form-section-note">
                    <Info size={14} /> Los clientes reportarán las transferencias de los productos a esta cuenta Banesco.
                  </p>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Teléfono Pago Móvil</label>
                      <input 
                        type="text" 
                        value={editingStoreFields.pago_movil_phone}
                        placeholder="Ej. 04121111111"
                        onChange={e => setEditingStoreFields({...editingStoreFields, pago_movil_phone: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Banco Receptor</label>
                      <input 
                        type="text" 
                        value={editingStoreFields.pago_movil_bank}
                        placeholder="Ej. Banesco"
                        onChange={e => setEditingStoreFields({...editingStoreFields, pago_movil_bank: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="form-row-2">
                    <div className="form-group">
                      <label>Cédula o RIF</label>
                      <input 
                        type="text" 
                        value={editingStoreFields.pago_movil_cedula}
                        placeholder="Ej. J-12345678"
                        onChange={e => setEditingStoreFields({...editingStoreFields, pago_movil_cedula: e.target.value})}
                      />
                    </div>
                    <div className="form-group">
                      <label>Titular de Cuenta</label>
                      <input 
                        type="text" 
                        value={editingStoreFields.pago_movil_holder}
                        placeholder="Ej. Arepera La Reina C.A."
                        onChange={e => setEditingStoreFields({...editingStoreFields, pago_movil_holder: e.target.value})}
                      />
                    </div>
                  </div>
                </div>

                <div className="form-actions-submit">
                  <button type="submit" className="save-store-btn">
                    <Save size={18} />
                    <span>Guardar Parámetros</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ==========================================
            TAB: INCOME (Sprint 3: Revenue Metrics)
            ========================================== */}
        {activeDashboardTab === 'income' && (
          <div className="tab-pane-income animate-fade-in">
            {/* Summary metrics cards */}
            <div className="merchant-income-grid">
              <div className="income-stat-card shadow-sm">
                <div className="stat-icon-circle green">
                  <DollarSign size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">Ingresos Totales</span>
                  <span className="stat-value text-green">{formatCurrency(incomeMetrics.totalEarnings)}</span>
                  <span className="stat-subtitle">De órdenes entregadas exitosamente</span>
                </div>
              </div>

              <div className="income-stat-card shadow-sm">
                <div className="stat-icon-circle blue">
                  <ClipboardList size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">Entregas Completadas</span>
                  <span className="stat-value">{incomeMetrics.totalOrdersCount}</span>
                  <span className="stat-subtitle">Pedidos finalizados</span>
                </div>
              </div>

              <div className="income-stat-card shadow-sm">
                <div className="stat-icon-circle purple">
                  <TrendingUp size={20} />
                </div>
                <div className="stat-info">
                  <span className="stat-label">Ticket Promedio</span>
                  <span className="stat-value text-purple">{formatCurrency(incomeMetrics.avgOrderValue)}</span>
                  <span className="stat-subtitle">Gasto promedio por cliente</span>
                </div>
              </div>
            </div>

            {/* Transactions audit list */}
            <div className="income-transactions-container shadow-sm">
              <div className="income-transactions-header">
                <h2>Historial de Auditoría de Transacciones (Pago Móvil)</h2>
              </div>

              {incomeMetrics.transactions.length === 0 ? (
                <div className="merchant-empty-pane">
                  <TrendingUp size={36} strokeWidth={1.5} color="var(--higo-gray-300)" />
                  <p>Sin transacciones históricas registradas</p>
                </div>
              ) : (
                <div className="income-transactions-table-wrapper">
                  <table className="income-transactions-table">
                    <thead>
                      <tr>
                        <th>ID de Orden</th>
                        <th>Fecha & Hora</th>
                        <th>Método</th>
                        <th>Ref. Pago Móvil</th>
                        <th>Ingreso</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeMetrics.transactions.map(t => (
                        <tr key={t.id}>
                          <td className="tx-id">#{t.id.slice(0, 8)}...</td>
                          <td className="tx-date">
                            {new Date(t.createdAt).toLocaleDateString('es-VE')} {new Date(t.createdAt).toLocaleTimeString('es-VE', {hour: '2-digit', minute:'2-digit'})}
                          </td>
                          <td className="tx-method">📱 Pago Móvil</td>
                          <td className="tx-ref">
                            <span className="ref-badge">{t.reference_number || 'Verificado'}</span>
                          </td>
                          <td className="tx-amount">{formatCurrency(t.productTotal)}</td>
                          <td className="tx-status">
                            <span className="status-dot-label">● Entregado</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
