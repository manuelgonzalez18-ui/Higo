from pathlib import Path
import runpy


patch_script = Path('scripts/apply_driver_ghost_offer_fix.py')
text = patch_script.read_text(encoding='utf-8')
old = '    expected=2,\n)\n\nnew_realtime_effect'
new = '    expected=1,\n)\n\nnew_realtime_effect'
if text.count(old) != 1:
    raise SystemExit('unable to normalize notification replacement count')
patch_script.write_text(text.replace(old, new, 1), encoding='utf-8')

runpy.run_path(str(patch_script), run_name='__main__')

# The deep-link handler has less indentation than the notification action
# handler, so patch it independently after the main exact integration.
dashboard = Path('src/pages/DriverDashboard.jsx')
source = dashboard.read_text(encoding='utf-8')
old_accept = """                            await supabase.from('rides')
                                .update({ status: 'accepted', driver_id: user.id })
                                .eq('id', rideId)
                                .eq('status', 'requested');
"""
new_accept = "                            await acceptRideRequest(rideId);\n"
if source.count(old_accept) != 1:
    raise SystemExit(f'deep-link accept block count={source.count(old_accept)}')
dashboard.write_text(source.replace(old_accept, new_accept, 1), encoding='utf-8')
