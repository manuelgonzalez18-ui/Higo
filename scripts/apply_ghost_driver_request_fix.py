from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}\n--- needle ---\n{old}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


# The driver dashboard owns authoritative ride-offer UI. App.jsx's legacy
# foreground FCM overlay can replay a queued ride_request after login and show
# a second card that is not validated against the current ride/offer state.
replace_once(
    'src/App.jsx',
    "import DriverRequestCard from './components/DriverRequestCard';\n",
    '',
)
replace_once(
    'src/App.jsx',
    "  const [incomingRequest, setIncomingRequest] = useState(null);\n",
    '',
)

old_push = '''      if (data.type === 'ride_request' || title?.includes('Nuevo Viaje') || title?.includes('Request')) {
        setIncomingRequest({
          price: data.price || '1.5',
          distance: data.distance || '1.9 km',
          duration: data.duration || '15 min',
          pickupLocation: data.pickupLocation || 'Ubicación Actual',
          pickupAddress: data.pickupAddress || 'Downtown District',
          dropoffLocation: data.dropoffLocation || 'Destino',
          dropoffAddress: data.dropoffAddress || 'Dirección de destino',
          service_type: data.service_type || 'ride',
          delivery_info: data.delivery_info ? JSON.parse(data.delivery_info) : null,
          instructions: data.instructions || data.delivery_instructions || null,
        });
      }
'''
new_push = '''      // Ride offers are rendered only by DriverDashboard after validating the
      // current database state. A foreground/queued FCM ride_request may be
      // delivered again at login; rendering it globally creates a ghost card.
      if (data.type === 'ride_request' || title?.includes('Nuevo Viaje') || title?.includes('Request')) {
        return;
      }
'''
replace_once('src/App.jsx', old_push, new_push)

replace_once(
    'src/App.jsx',
    '''  const handleAcceptRequest = () => {
    setIncomingRequest(null);
  };

  const handleDeclineRequest = () => {
    setIncomingRequest(null);
  };

''',
    '',
)

replace_once(
    'src/App.jsx',
    '''      {/* Driver Request Overlay */}
      <DriverRequestCard
        isVisible={!!incomingRequest}
        request={incomingRequest}
        onAccept={handleAcceptRequest}
        onDecline={handleDeclineRequest}
      />

''',
    '',
)

# Never hydrate a login card from the broad ten-minute requested-rides window.
# A valid progressive-dispatch offer is short-lived, unassigned and recent.
replace_once(
    'src/pages/DriverDashboard.jsx',
    '''            const fetchExistingRequests = async () => {
                const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
                const { data } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('status', 'requested')
                    .gte('created_at', tenMinAgo)
                    .order('created_at', { ascending: false })
                    .limit(20);

                if (data) {
                    processRequests(data, true);
                }
            };
''',
    '''            const fetchExistingRequests = async () => {
                // Directed offers expire quickly. The previous ten-minute
                // recovery window resurrected already-consumed requests every
                // time a driver logged in. RLS still gates the directed offer;
                // these extra predicates prevent stale/unassigned races.
                const activeWindowStart = new Date(Date.now() - 60 * 1000).toISOString();
                const { data, error } = await supabase
                    .from('rides')
                    .select('*')
                    .eq('status', 'requested')
                    .is('driver_id', null)
                    .gte('created_at', activeWindowStart)
                    .order('created_at', { ascending: false })
                    .limit(10);

                if (error) {
                    console.error('[DriverOffers] Could not resync active requests:', error);
                    setRequests([]);
                    return;
                }
                processRequests(data || [], true);
            };
''',
)

replace_once(
    'src/pages/DriverDashboard.jsx',
    '''                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
                    if (payload.new.status !== 'requested') {
                        setRequests(prev => prev.filter(r => r.id !== payload.new.id));
                    }
                })
''',
    '''                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides' }, (payload) => {
                    if (payload.new.status !== 'requested' || payload.new.driver_id) {
                        setRequests(prev => prev.filter(r => r.id !== payload.new.id));
                        stopLoopingRequestAlert();
                    }
                })
''',
)

# Revalidate after returning from background/login transitions because Realtime
# does not replay events missed while the app was suspended.
replace_once(
    'src/pages/DriverDashboard.jsx',
    '''            return () => {
                if (channel) supabase.removeChannel(channel);
            };
        };

        setupRealtime();

        return () => {
            if (channel) supabase.removeChannel(channel);
        };
    }, [isOnline, processRequests]);
''',
    '''            return () => {
                if (channel) supabase.removeChannel(channel);
            };
        };

        setupRealtime();

        const resyncOnVisible = () => {
            if (document.visibilityState === 'visible') {
                setRequests([]);
                setupRealtime();
            }
        };
        document.addEventListener('visibilitychange', resyncOnVisible);

        return () => {
            document.removeEventListener('visibilitychange', resyncOnVisible);
            if (channel) supabase.removeChannel(channel);
        };
    }, [isOnline, processRequests]);
''',
)
