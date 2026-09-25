import { fmt } from '../data.js'

export default function About({ data }) {
  const { meta } = data
  const groups = [
    ['fln', 'FLN classrooms (Grades 1-3 Hindi & Maths)'],
    ['upper', 'Grades 4-8 classrooms'],
    ['school', 'School-level'],
  ]
  return (
    <div className="prose">
      <div className="page-head">
        <div className="crumbs">Dashboard / Definitions</div>
        <h1>Definitions and data notes</h1>
      </div>

      <h3>Source</h3>
      <p>
        Mentor-app classroom observation exports for {meta.district} district, {fmt.date(meta.dateFrom)} to {fmt.date(meta.dateTo)} ({meta.sourceFiles.length} monthly files,{' '}
        {fmt.int(data.visits.length)} observations). No data for June 2026 (summer vacation). Last rebuilt {new Date(meta.generatedAt).toLocaleString('en-IN')}.
      </p>

      <h3>Counting</h3>
      <dl>
        <dt>Visit</dt>
        <dd>One classroom observation form submitted by a mentor. Almost every school visit has exactly one observation.</dd>
        <dt>ARP target</dt>
        <dd>
          {meta.arpMonthlyTarget} visits per ARP per month. For a quarter or year, the target is {meta.arpMonthlyTarget} × the number of months in that period that have
          data (so June 2026 does not count against anyone). When school type, grade or subject filters are on, only matching visits count toward the target.
        </dd>
        <dt>ARPs on roster</dt>
        <dd>Mentors whose designation is ARP or ARP Nagar and who appear in the data at least once. An ARP's block is the block where most of their visits were.</dd>
        <dt>DIET Mentors & SRGs</dt>
        <dd>Tracked on their own page with no visit target.</dd>
        <dt>Schools</dt>
        <dd>
          Built from the visit data ({fmt.int(data.schools.length)} schools with at least one visit). There is no master school list, so a school that was never visited is not shown.
          School type (PS / UPS / Composite) comes from the export.
        </dd>
        <dt>Periods</dt>
        <dd>Quarters and years follow the Indian financial year (Q1 = Apr-Jun … Q4 = Jan-Mar).</dd>
        <dt>Attendance</dt>
        <dd>Total present ÷ total enrolled (or in-position, for teachers) across visits, as recorded by the mentor on the visit day. Rows where present exceeds enrolled are skipped.</dd>
      </dl>

      <h3>Practice scores</h3>
      <p>
        Each observation gets a score: the share of the applicable KPIs below (marked ★) that were seen. The <b>FLN practice score</b> covers Grade 1-3 Hindi and Maths
        classrooms and the <b>Grades 4-8 practice score</b> covers Grade 4-8 classrooms. The two are kept separate because they use different checklists, and the Grades 4-8
        items are answered "yes" far more often. On the Grades 4-8 form a "no" to <i>lesson plan prepared</i> skips every other question, so the Grades 4-8
        score covers only classrooms that had a plan, and lesson-plan readiness is reported on its own. A mentor's or block's score is the average over the observations they made. It describes the classrooms observed, not the
        mentor's performance.
      </p>

      <h3>KPIs</h3>
      {groups.map(([g, title]) => (
        <div key={g}>
          <h4>{title}</h4>
          <ul>
            {meta.kpis
              .filter((k) => k.group === g)
              .map((k) => (
                <li key={k.id}>
                  {k.label} {k.inScore && <span title="Counts toward the practice score">★</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="muted small">
        Answers of "partial" or "some children" count as not done. "Not applicable" answers, and "NIPUN Talika not supplied by the department", are left out of the
        denominator. The assessment tracker counts only when it is filled regularly <i>and</i> children are grouped into A and B. There is no student learning-outcome data in
        this export. The "5 random students" field holds names only and is not published.
      </p>

      <h3>Privacy</h3>
      <p>
        Teacher and mentor mobile numbers, teacher HRMS codes, student names and free-text remarks are removed when the data is built, and are not in this site. Teacher and
        school names are shown.
      </p>
    </div>
  )
}
