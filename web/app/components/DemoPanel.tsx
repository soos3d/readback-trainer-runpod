// Shown only at ?demo=1 (SPEC §13.3). The checkboxes join the Controls form through form="controls".
// The server ignores them unless READBACK_DEMO_MODE=1.
import css from "../page.module.css";

export function DemoPanel() {
  return (
    <fieldset className={css.demo}>
      <legend>Demo: simulate an outage on the next call</legend>
      <label><input type="checkbox" form="controls" name="simulate" value="awc_down" /> AviationWeather down</label>
      <label><input type="checkbox" form="controls" name="simulate" value="opensky_down" /> OpenSky down</label>
    </fieldset>
  );
}
