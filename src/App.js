import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { read, utils } from 'xlsx';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import './App.css';

// --- HELPER FUNCTIONS (No changes needed) ---
const getBaseCourseCode = (raw) => {
    if (!raw) return '';
    const match = String(raw).match(/([A-Z]{4})[- ]?([0-9]{4})/i);
    if (match) return `${match[1].toUpperCase()}-${match[2]}`;
    const str = String(raw).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (str.length === 8) return `${str.slice(0, 4)}-${str.slice(4)}`;
    if (str.length === 7) return `${str.slice(0, 4)}-${str.slice(3)}`;
    return str;
};

const getLastName = (fullName, lastNameOnly) => {
    if (lastNameOnly) return lastNameOnly;
    if (typeof fullName !== 'string' || !fullName.trim()) return '';
    const trimmedName = fullName.trim();
    if (trimmedName.includes(',')) return trimmedName.split(',')[0].trim();
    const parts = trimmedName.split(' ');
    return parts[parts.length - 1];
};

const formatPrice = (price) => Math.round(price).toLocaleString();

const checkConflict = (sectionA, sectionB) => {
    if (!sectionA.Days || !sectionA.Time || !sectionB.Days || !sectionB.Time) return false;
    const daysA = sectionA.Days.split('');
    const daysB = sectionB.Days.split('');
    const dayConflict = daysA.some(day => daysB.includes(day));
    if (!dayConflict) return false;

    const parseTime = (timeStr) => {
        if (!timeStr || !timeStr.includes('-')) return { start: 0, end: 0 };
        const [startTime, endTime] = timeStr.split('-');
        const convertToMinutes = (t) => {
            const match = t.match(/(\d+:\d+)(\w+)/);
            if (!match) return 0;
            const [, time, period] = match;
            let [hours, minutes] = time.split(':').map(Number);
            if (period.toLowerCase().startsWith('p') && hours !== 12) hours += 12;
            if (period.toLowerCase().startsWith('a') && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };
        return { start: convertToMinutes(startTime), end: convertToMinutes(endTime) };
    };

    const timeA = parseTime(sectionA.Time);
    const timeB = parseTime(sectionB.Time);
    return timeA.start < timeB.end && timeB.start < timeA.end;
};

// --- COMPONENTS ---
const CourseRow = React.memo(({ course, detailCode, onSelect }) => (
    <tr
        className="banded-row"
        style={{ background: detailCode === course.Course_Code ? '#D3E4FF' : undefined, cursor: 'pointer' }}
        onClick={() => onSelect(course.Course_Code)}
    >
        <td>{course.Course_Code}</td>
        <td>{course.Title}</td>
        <td className="numeric">${formatPrice(course.Average_Price)}</td>
        <td>{course.Terms}</td>
        <td className="numeric">{course.Credits}</td>
        <td className="numeric">{course.course_rating !== null ? course.course_rating.toFixed(2) : 'N/A'}</td>
        <td className="numeric">{course.instructor_rating !== null ? course.instructor_rating.toFixed(2) : 'N/A'}</td>
        <td className="numeric">{course.difficulty_rating !== null ? course.difficulty_rating.toFixed(2) : 'N/A'}</td>
        <td className="numeric">{course.work_rating !== null ? course.work_rating.toFixed(2) : 'N/A'}</td>
    </tr>
));

function App() {
    // --- STATE ---
    const [courses, setCourses] = useState([]);
    const [selectedSessions, setSelectedSessions] = useState({});
    const [detailCode, setDetailCode] = useState(null);
    const [filters, setFilters] = useState({ dept: '', day: '', time: '', term: '', credits: '' });
    const [sortConfig, setSortConfig] = useState({ key: 'Course_Code', direction: 'ascending' });
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [calendarView, setCalendarView] = useState('Overall'); // 'Overall', 'Q1', or 'Q2'

    // --- DATA FETCHING ---
    useEffect(() => {
        const fetchFiles = async () => {
            setIsLoading(true);
            try {
                // Fetching logic is unchanged
                const [csvRes, xlsxRes] = await Promise.all([
                    fetch('/final_combined_course_data.csv'),
                    fetch('/Prices.xlsx')
                ]);
                const csvArrayBuffer = await csvRes.arrayBuffer();
                const xlsxArrayBuffer = await xlsxRes.arrayBuffer();

                const csvWb = read(csvArrayBuffer, { type: 'array' });
                const csvWs = csvWb.Sheets[csvWb.SheetNames[0]];
                const csvData = utils.sheet_to_json(csvWs, { header: 0 });

                const xlsxWb = read(xlsxArrayBuffer, { type: 'array' });
                const xlsxWs = xlsxWb.Sheets[xlsxWb.SheetNames[0]];
                const priceMap = utils.sheet_to_json(xlsxWs, { header: 0 }).reduce((acc, r) => {
                    const code = getBaseCourseCode(r.Course_ID);
                    if (code) acc[code] = parseFloat(r.Average_Price) || 0;
                    return acc;
                }, {});

                // Data processing logic is unchanged
                const courseMap = csvData.reduce((acc, row) => {
                    const code = getBaseCourseCode(row.Course_ID);
                    if (!code) return acc;
                    if (!acc[code]) {
                        acc[code] = {
                            Course_Code: code,
                            Title: row.Title,
                            course_rating: row.base_course_quality ? parseFloat(row.base_course_quality) : null,
                            instructor_rating: row.base_instructor_quality ? parseFloat(row.base_instructor_quality) : null,
                            difficulty_rating: row.base_difficulty ? parseFloat(row.base_difficulty) : null,
                            work_rating: row.base_work_required ? parseFloat(row.base_work_required) : null,
                            Average_Price: priceMap[code] || 0,
                            sections: {},
                        };
                    }
                    if (row.Section_ID) {
                        if (!acc[code].sections[row.Section_ID]) {
                            acc[code].sections[row.Section_ID] = {
                                Session_ID: row.Section_ID,
                                Meetings: `${row.Meetings_Days || ''} ${row.Meetings_Time || ''}`.trim(),
                                Days: row.Meetings_Days,
                                Time: row.Meetings_Time,
                                Term: row.Term,
                                Credits: row.CU,
                                instructors: [],
                            };
                        }
                        acc[code].sections[row.Section_ID].instructors.push({
                            name: getLastName(row.Instructor, row.Instructor_last),
                            Course_Quality: row.review_rCourseQuality ? parseFloat(row.review_rCourseQuality) : null,
                            Instructor_Quality: row.review_rInstructorQuality ? parseFloat(row.review_rInstructorQuality) : null,
                            Difficulty: row.review_rDifficulty ? parseFloat(row.review_rDifficulty) : null,
                            Work_Required: row.review_rWorkRequired ? parseFloat(row.review_rWorkRequired) : null,
                        });
                    }
                    return acc;
                }, {});
                const coursesWithAggregates = Object.values(courseMap).map(course => {
                    const sectionsArray = Object.values(course.sections);
                    const allTerms = sectionsArray.map(s => s.Term);
                    const allCredits = sectionsArray.map(s => s.Credits);
                    return {
                        ...course,
                        sections: sectionsArray,
                        Terms: [...new Set(allTerms)].filter(Boolean).join(', '),
                        Credits: [...new Set(allCredits)].filter(c => c != null).join(', '),
                    };
                });
                setCourses(coursesWithAggregates);

            } catch (error) {
                console.error("Error loading files:", error);
            }
            setIsLoading(false);
        };
        fetchFiles();
    }, []);

    // --- UI HANDLERS & MEMOIZED DATA ---
    const handleFilterChange = useCallback((e) => setFilters(prev => ({ ...prev, [e.target.name]: e.target.value })), []);
    const resetFilters = useCallback(() => { setFilters({ dept: '', day: '', time: '', term: '', credits: '' }); setSearchQuery(''); }, []);
    const toggleSession = useCallback((id) => setSelectedSessions(prev => ({ ...prev, [id]: !prev[id] })), []);
    const requestSort = useCallback((key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'ascending' ? 'descending' : 'ascending' })), []);
    
    const filterOptions = useMemo(() => {
        const depts = [...new Set(courses.map(c => c.Course_Code.slice(0, 4)))].sort();
        const allSections = courses.flatMap(c => c.sections || []);
        const uniqueDays = [...new Set(allSections.map(s => s.Days))].filter(Boolean).sort();
        const uniqueTimes = [...new Set(allSections.map(s => s.Time))].filter(Boolean).sort();
        const uniqueTerms = [...new Set(allSections.map(s => s.Term))].filter(Boolean).sort();
        const uniqueCredits = [...new Set(allSections.map(s => String(s.Credits)))].filter(Boolean).sort((a, b) => Number(a) - Number(b));
        return { depts, uniqueDays, uniqueTimes, uniqueTerms, uniqueCredits };
    }, [courses]);

    const filteredCourses = useMemo(() => {
        const { dept, day, time, term, credits } = filters;
        const lowerCaseQuery = searchQuery.toLowerCase();
        return courses.filter(c => {
            const matchesSearch = lowerCaseQuery === '' || c.Course_Code.toLowerCase().includes(lowerCaseQuery) || c.Title.toLowerCase().includes(lowerCaseQuery);
            return matchesSearch &&
                (!dept || c.Course_Code.startsWith(dept)) &&
                (!day || c.sections.some(s => s.Days === day)) &&
                (!time || c.sections.some(s => s.Time === time)) &&
                (!term || c.sections.some(s => s.Term === term)) &&
                (!credits || c.sections.some(s => String(s.Credits) === credits));
        });
    }, [courses, filters, searchQuery]);

    const sortedCourses = useMemo(() => {
        const arr = [...filteredCourses];
        arr.sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
            return 0;
        });
        return arr;
    }, [filteredCourses, sortConfig]);

    const renderArrow = useCallback((col) => (sortConfig.key === col ? (sortConfig.direction === 'ascending' ? ' ▲' : ' ▼') : ''), [sortConfig]);

    const { selectedList, total } = useMemo(() => {
        const list = [];
        courses.forEach(course => {
            course.sections.forEach(section => {
                if (selectedSessions[section.Session_ID]) {
                    let instructorText = "N/A";
                    if (section.instructors.length > 1) instructorText = "Multiple Instructors";
                    else if (section.instructors.length === 1) instructorText = section.instructors[0].name;
                    list.push({ ...section, Course_Code: course.Course_Code, Instructor: instructorText, Price: course.Average_Price });
                }
            });
        });
        const checkedList = list.map(s => ({ ...s, isConflicting: false }));
        for (let i = 0; i < checkedList.length; i++) {
            for (let j = i + 1; j < checkedList.length; j++) {
                if (checkConflict(checkedList[i], checkedList[j])) {
                    checkedList[i].isConflicting = true;
                    checkedList[j].isConflicting = true;
                }
            }
        }
        const totalPrice = checkedList.reduce((sum, s) => s.isConflicting ? sum : sum + s.Price, 0);
        return { selectedList: checkedList, total: totalPrice };
    }, [courses, selectedSessions]);

    const detailCourse = useMemo(() => courses.find(c => c.Course_Code === detailCode), [courses, detailCode]);

    const calendarEvents = useMemo(() => {
        const dayMap = { 'M': 1, 'T': 2, 'W': 3, 'R': 4, 'F': 5 };
        const termColors = { 'Full': '#3788d8', 'Q1': '#4caf50', 'Q2': '#ff9800' };

        const formatTime = (timeStr) => {
            const match = timeStr.match(/(\d+):(\d+)(\w+)/);
            if (!match) return '00:00';
            let [, hours, minutes, period] = match;
            hours = parseInt(hours);
            if (period.toLowerCase().startsWith('p') && hours !== 12) hours += 12;
            if (period.toLowerCase().startsWith('a') && hours === 12) hours = 0;
            return `${String(hours).padStart(2, '0')}:${minutes}:00`;
        };
        
        const termsToShow = calendarView === 'Overall' 
            ? ['Full', 'Q1', 'Q2'] 
            : (calendarView === 'Q1' ? ['Full', 'Q1'] : ['Full', 'Q2']);

        return selectedList
            .filter(section => 
                section.Time && 
                section.Days && 
                !section.isConflicting &&
                termsToShow.includes(section.Term)
            )
            .flatMap(section => {
                const [startTime, endTime] = section.Time.split('-');
                if (!startTime || !endTime) return [];
                const days = section.Days.split('').map(day => dayMap[day]).filter(Boolean);
                if (days.length === 0) return [];
                
                return { 
                    title: section.Course_Code, 
                    daysOfWeek: days, 
                    startTime: formatTime(startTime), 
                    endTime: formatTime(endTime), 
                    allDay: false,
                    color: termColors[section.Term] || '#808080'
                };
            });
    }, [selectedList, calendarView]);

    if (isLoading) {
        return <div className="loading-container">Loading courses...</div>;
    }

    // --- RENDER ---
    return (
        <>
            <div className="container" style={{ display: 'flex', height: '100vh', padding: '1rem', boxSizing: 'border-box' }}>
                {/* Left Pane: Course List */}
                <div className="side-pane" style={{ flex: 3, display: 'flex', flexDirection: 'column', border: '1px solid #dee2e6', overflow: 'hidden' }}>
                    <div style={{ padding: '0.5rem' }}>
                        <div className="search-bar" style={{ marginBottom: '8px' }}>
                            <input
                                type="text"
                                placeholder="Search by course code or title..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
                            />
                        </div>
                        <div className="filters">
                            <select name="dept" value={filters.dept} onChange={handleFilterChange}><option value="">All Depts</option>{filterOptions.depts.map(d => <option key={d} value={d}>{d}</option>)}</select>
                            <select name="day" value={filters.day} onChange={handleFilterChange} style={{ marginLeft: '4px' }}><option value="">All Days</option>{filterOptions.uniqueDays.map(d => <option key={d} value={d}>{d}</option>)}</select>
                            <select name="time" value={filters.time} onChange={handleFilterChange} style={{ marginLeft: '4px' }}><option value="">All Times</option>{filterOptions.uniqueTimes.map(t => <option key={t} value={t}>{t}</option>)}</select>
                            <select name="term" value={filters.term} onChange={handleFilterChange} style={{ marginLeft: '4px' }}><option value="">All Terms</option>{filterOptions.uniqueTerms.map(t => <option key={t} value={t}>{t}</option>)}</select>
                            <select name="credits" value={filters.credits} onChange={handleFilterChange} style={{ marginLeft: '4px' }}><option value="">All Credits</option>{filterOptions.uniqueCredits.map(c => <option key={c} value={c}>{c}</option>)}</select>
                            <button onClick={resetFilters} style={{ marginLeft: '8px' }}>Reset</button>
                        </div>
                    </div>
                    <div className="list-pane">
                        <table>
                            <thead>
                                <tr>
                                    <th onClick={() => requestSort('Course_Code')}>Code{renderArrow('Course_Code')}</th>
                                    <th onClick={() => requestSort('Title')}>Course{renderArrow('Title')}</th>
                                    <th className="numeric" onClick={() => requestSort('Average_Price')}>Price{renderArrow('Average_Price')}</th>
                                    <th onClick={() => requestSort('Terms')}>Term(s){renderArrow('Terms')}</th>
                                    <th className="numeric" onClick={() => requestSort('Credits')}>Credit(s){renderArrow('Credits')}</th>
                                    <th className="numeric" onClick={() => requestSort('course_rating')}>Course{renderArrow('course_rating')}</th>
                                    <th className="numeric" onClick={() => requestSort('instructor_rating')}>Instructor{renderArrow('instructor_rating')}</th>
                                    <th className="numeric" onClick={() => requestSort('difficulty_rating')}>Difficulty{renderArrow('difficulty_rating')}</th>
                                    <th className="numeric" onClick={() => requestSort('work_rating')}>Work{renderArrow('work_rating')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedCourses.length > 0 ? (
                                    sortedCourses.map(c => <CourseRow key={c.Course_Code} course={c} detailCode={detailCode} onSelect={setDetailCode} />)
                                ) : (
                                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '1rem' }}>No courses match your filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Right Pane: Details & Calculator */}
                <div className="main-pane" style={{ flex: 2, display: 'flex', flexDirection: 'column', marginLeft: '1rem', overflow: 'hidden' }}>
                    <div className="detail-pane" style={{ flex: 1, border: '1px solid #dee2e6', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        {detailCourse ? (
                            <>
                                <h3 style={{padding: '0.5rem', margin: 0}}>Sections for {detailCode}</h3>
                                <div style={{overflowY: 'auto', flex: 1}}>
                                    {detailCourse.sections.length > 0 ? (
                                        <table>
                                            <thead><tr><th>Select</th><th>Section</th><th>Meetings</th><th>Instructor</th><th className="numeric">Course</th><th className="numeric">Instructor</th><th className="numeric">Difficulty</th><th className="numeric">Work</th></tr></thead>
                                            <tbody>
                                                {detailCourse.sections.map(section => {
                                                    const { day, time, term, credits } = filters;
                                                    const isMatch = (!day || section.Days === day) && (!time || section.Time === time) && (!term || section.Term === term) && (!credits || String(section.Credits) === credits);
                                                    return (<React.Fragment key={section.Session_ID}>{section.instructors.map((instructor, index) => (<tr key={index} className={`banded-row ${!isMatch ? 'non-matching-row' : ''}`}>{index === 0 && <td rowSpan={section.instructors.length}><input type="checkbox" checked={!!selectedSessions[section.Session_ID]} onChange={() => toggleSession(section.Session_ID)} disabled={!isMatch} /></td>}{index === 0 && <td rowSpan={section.instructors.length}>{String(section.Session_ID).slice(-3)}</td>}{index === 0 && <td rowSpan={section.instructors.length}>{section.Meetings}</td>}<td>{instructor.name}</td><td className="numeric">{instructor.Course_Quality !== null ? instructor.Course_Quality.toFixed(2) : 'N/A'}</td><td className="numeric">{instructor.Instructor_Quality !== null ? instructor.Instructor_Quality.toFixed(2) : 'N/A'}</td><td className="numeric">{instructor.Difficulty !== null ? instructor.Difficulty.toFixed(2) : 'N/A'}</td><td className="numeric">{instructor.Work_Required !== null ? instructor.Work_Required.toFixed(2) : 'N/A'}</td></tr>))}</React.Fragment>);
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <p style={{padding: '1rem'}}>No sections found for this course.</p>
                                    )}
                                </div>
                            </>
                        ) : <p style={{padding: '1rem'}}>Select a course to view sections</p>}
                    </div>
                    <div className="calculator" style={{ flex: 1, border: '1px solid #dee2e6', marginTop: '1rem', display: 'flex', flexDirection: 'column' }}>
                        <h2 style={{padding: '0.5rem', margin: 0}}>Selected Sections</h2>
                        <div style={{overflowY: 'auto', flex: 1}}>
                            <table>
                                <thead><tr><th>Code</th><th>Instructor(s)</th><th>Meetings</th><th className="numeric">Price</th><th></th></tr></thead>
                                <tbody>
                                    {selectedList.length > 0 ? (
                                        selectedList.map(s => (
                                            <tr key={s.Session_ID} className="banded-row" style={{ backgroundColor: s.isConflicting ? '#FFD2D2' : undefined }}>
                                                <td>{s.isConflicting && '⚠️ '}{s.Course_Code}</td>
                                                <td>{s.Instructor}</td>
                                                <td>{s.Meetings}</td>
                                                <td className="numeric" style={{ textDecoration: s.isConflicting ? 'line-through' : 'none' }}>${formatPrice(s.Price)}</td>
                                                <td><button onClick={() => toggleSession(s.Session_ID)}>Remove</button></td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '1rem' }}>No sections selected.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="total" style={{padding: '0.5rem', textAlign: 'right'}}>Total (no conflicts): ${formatPrice(total)}</div>
                    </div>
                </div>
            </div>

            {/* Calendar Tab */}
            <div className="calendar-tab" onClick={() => setIsCalendarOpen(true)}>
                Calendar
            </div>

            {/* Calendar Drawer */}
            <div className={`calendar-drawer ${isCalendarOpen ? 'open' : ''}`}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                    <h2>Weekly Schedule</h2>
                    <button onClick={() => setIsCalendarOpen(false)} style={{fontSize: '1.5rem', border: 'none', background: 'none', cursor: 'pointer'}}>&times;</button>
                </div>
                
                {/* Legend */}
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>Legend:</strong>
                    <span style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: '15px', height: '15px', backgroundColor: '#3788d8', marginRight: '5px' }}></div>Full Term</span>
                    <span style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: '15px', height: '15px', backgroundColor: '#4caf50', marginRight: '5px' }}></div>Q1</span>
                    <span style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: '15px', height: '15px', backgroundColor: '#ff9800', marginRight: '5px' }}></div>Q2</span>
                </div>

                {/* Quarter Toggle */}
                <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
                    <button 
                        onClick={() => setCalendarView('Overall')}
                        style={{ padding: '8px 12px', cursor: 'pointer', border: '1px solid #ccc', backgroundColor: calendarView === 'Overall' ? '#007bff' : 'white', color: calendarView === 'Overall' ? 'white' : 'black' }}
                    >
                        Overall
                    </button>
                    <button 
                        onClick={() => setCalendarView('Q1')}
                        style={{ padding: '8px 12px', cursor: 'pointer', border: '1px solid #ccc', backgroundColor: calendarView === 'Q1' ? '#007bff' : 'white', color: calendarView === 'Q1' ? 'white' : 'black' }}
                    >
                        Quarter 1
                    </button>
                    <button 
                        onClick={() => setCalendarView('Q2')}
                        style={{ padding: '8px 12px', cursor: 'pointer', border: '1px solid #ccc', backgroundColor: calendarView === 'Q2' ? '#007bff' : 'white', color: calendarView === 'Q2' ? 'white' : 'black' }}
                    >
                        Quarter 2
                    </button>
                </div>

                <div style={{ flex: 1 }}>
                    <FullCalendar
                        plugins={[timeGridPlugin]}
                        initialView="timeGridWeek"
                        headerToolbar={false}
                        weekends={false}
                        allDaySlot={false}
                        events={calendarEvents}
                        slotMinTime="08:00:00"
                        slotMaxTime="22:00:00"
                        height="100%"
                    />
                </div>
            </div>
        </>
    );
}

export default App;