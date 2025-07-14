import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { read, utils } from 'xlsx';
import './App.css';

// Helper functions (getBaseCourseCode, getLastName, formatPrice) remain the same.

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

const formatPrice = (price) => {
    return Math.round(price).toLocaleString();
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
    // Restore state for both CSV data and Price data
    const [csvData, setCsvData] = useState([]);
    const [priceData, setPriceData] = useState({});
    const [courses, setCourses] = useState([]);
    const [selectedSessions, setSelectedSessions] = useState({});
    const [detailCode, setDetailCode] = useState(null);
    const [filters, setFilters] = useState({ dept: '', day: '', time: '', term: '', credits: '' });
    const [sortConfig, setSortConfig] = useState({ key: 'Course_Code', direction: 'ascending' });

    // --- DATA FETCHING ---
    // This effect fetches both files when the component mounts.
    useEffect(() => {
        const fetchFiles = async () => {
            try {
                // Fetch and process the main course data CSV
                const csvResponse = await fetch('/final_combined_course_data.csv');
                const csvArrayBuffer = await csvResponse.arrayBuffer();
                const csvWb = read(csvArrayBuffer, { type: 'array' });
                const csvWs = csvWb.Sheets[csvWb.SheetNames[0]];
                const csvRows = utils.sheet_to_json(csvWs, { header: 0 });
                setCsvData(csvRows);

                // Fetch and process the prices XLSX
                const xlsxResponse = await fetch('/Prices.xlsx');
                const xlsxArrayBuffer = await xlsxResponse.arrayBuffer();
                const xlsxWb = read(xlsxArrayBuffer, { type: 'array' });
                const xlsxWs = xlsxWb.Sheets[xlsxWb.SheetNames[0]];
                const xlsxRows = utils.sheet_to_json(xlsxWs, { header: 0 });
                
                // Create the price map from the XLSX data
                const priceMap = xlsxRows.reduce((acc, r) => {
                    const code = getBaseCourseCode(r.Course_ID);
                    if (code) {
                      acc[code] = parseFloat(r.Average_Price) || 0;
                    }
                    return acc;
                }, {});
                setPriceData(priceMap);

            } catch (error) {
                console.error("Error loading or parsing files:", error);
            }
        };

        fetchFiles();
    }, []);

    // --- DATA PROCESSING ---
    // This effect runs whenever the csvData or priceData state is updated.
    useEffect(() => {
        // Ensure both data sources are loaded before processing
        if (csvData.length === 0 || Object.keys(priceData).length === 0) {
            return;
        }

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
                    // Look up the price from the priceData state
                    Average_Price: priceData[code] || 0,
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
            const uniqueTerms = [...new Set(allTerms)].filter(Boolean).join(', ');
            const uniqueCredits = [...new Set(allCredits)].filter(c => c != null).join(', ');
            
            return {
                ...course,
                sections: sectionsArray,
                Terms: uniqueTerms,
                Credits: uniqueCredits,
            };
        });

        setCourses(coursesWithAggregates);

    }, [csvData, priceData]); // This effect now depends on both data sources

    // --- UI INTERACTION & MEMOIZED DATA ---
    // (No changes needed in the rest of the component)
    
    const handleFilterChange = useCallback((e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    }, []);

    const resetFilters = useCallback(() => {
        setFilters({ dept: '', day: '', time: '', term: '', credits: '' });
    }, []);

    const toggleSession = useCallback((id) => {
        setSelectedSessions(prev => ({ ...prev, [id]: !prev[id] }));
    }, []);
    
    const requestSort = useCallback((key) => {
        const direction = (sortConfig.key === key && sortConfig.direction === 'ascending') ? 'descending' : 'ascending';
        setSortConfig({ key, direction });
    }, [sortConfig]);

    const filterOptions = useMemo(() => {
        const depts = Array.from(new Set(courses.map(c => c.Course_Code.slice(0, 4)))).sort();
        const allSections = courses.flatMap(c => c.sections || []);
        const uniqueDays = Array.from(new Set(allSections.map(s => s.Days))).filter(Boolean).sort();
        const uniqueTimes = Array.from(new Set(allSections.map(s => s.Time))).filter(Boolean).sort();
        const uniqueTerms = Array.from(new Set(allSections.map(s => s.Term))).filter(Boolean).sort();
        const uniqueCredits = Array.from(new Set(allSections.map(s => String(s.Credits)))).filter(Boolean).sort((a, b) => Number(a) - Number(b));
        return { depts, uniqueDays, uniqueTimes, uniqueTerms, uniqueCredits };
    }, [courses]);

    const filteredCourses = useMemo(() => {
        const { dept, day, time, term, credits } = filters;
        if (!dept && !day && !time && !term && !credits) return courses;
        return courses.filter(c =>
            (!dept || c.Course_Code.startsWith(dept)) &&
            (!day || (c.sections || []).some(s => s.Days === day)) &&
            (!time || (c.sections || []).some(s => s.Time === time)) &&
            (!term || (c.sections || []).some(s => s.Term === term)) &&
            (!credits || (c.sections || []).some(s => String(s.Credits) === credits))
        );
    }, [courses, filters]);

    useEffect(() => {
        if (detailCode && !filteredCourses.some(c => c.Course_Code === detailCode)) {
            setDetailCode(null);
        }
    }, [filteredCourses, detailCode]);

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

    const renderArrow = useCallback((col) => {
        return sortConfig.key === col ? (sortConfig.direction === 'ascending' ? ' ▲' : ' ▼') : '';
    }, [sortConfig]);

    const { selectedList, total } = useMemo(() => {
        const list = [];
        courses.forEach(course => {
            (course.sections || []).forEach(section => {
                if (selectedSessions[section.Session_ID]) {
                    let instructorText = "N/A";
                    if (section.instructors.length > 1) instructorText = "Multiple Instructors";
                    else if (section.instructors.length === 1) instructorText = section.instructors[0].name;
                    
                    list.push({
                        Session_ID: section.Session_ID,
                        Course_Code: course.Course_Code,
                        Instructor: instructorText,
                        Meetings: section.Meetings,
                        Price: course.Average_Price,
                    });
                }
            });
        });
        const totalPrice = list.reduce((sum, s) => sum + s.Price, 0);
        return { selectedList: list, total: totalPrice };
    }, [courses, selectedSessions]);

    const detailCourse = useMemo(() => courses.find(c => c.Course_Code === detailCode), [courses, detailCode]);

    // --- RENDER ---
    // (The JSX remains the same as the previous version)
    return (
        <div className="container" style={{ display: 'flex', height: '100vh', padding: '1rem', boxSizing: 'border-box' }}>
            <div className="side-pane" style={{ flex: 3, display: 'flex', flexDirection: 'column', border: '1px solid #dee2e6', overflow: 'hidden' }}>
                <div style={{ padding: '0.5rem' }}>
                    <div className="filters">
                        <select name="dept" value={filters.dept} onChange={handleFilterChange}><option value="">All Departments</option>{filterOptions.depts.map(d => <option key={d} value={d}>{d}</option>)}</select>
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
                            {sortedCourses.map(c => (<CourseRow key={c.Course_Code} course={c} detailCode={detailCode} onSelect={setDetailCode} />))}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="main-pane" style={{ flex: 2, display: 'flex', flexDirection: 'column', marginLeft: '1rem', overflow: 'hidden' }}>
                <div className="detail-pane" style={{ flex: 1, border: '1px solid #dee2e6', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {detailCourse ? (
                        <>
                            <h3 style={{padding: '0.5rem', margin: 0}}>Sections for {detailCode}</h3>
                            <div style={{overflowY: 'auto', flex: 1}}>
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
                            </div>
                        </>
                    ) : (<p style={{padding: '1rem'}}>Select a course to view sections</p>)}
                </div>
                <div className="calculator" style={{ flex: 1, border: '1px solid #dee2e6', marginTop: '1rem', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{padding: '0.5rem', margin: 0}}>Selected Sections</h2>
                    <div style={{overflowY: 'auto', flex: 1}}>
                        <table>
                            <thead><tr><th>Code</th><th>Instructor(s)</th><th>Meetings</th><th className="numeric">Price</th><th></th></tr></thead>
                            <tbody>
                                {selectedList.map(s => (<tr key={s.Session_ID} className="banded-row"><td>{s.Course_Code}</td><td>{s.Instructor}</td><td>{s.Meetings}</td><td className="numeric">${formatPrice(s.Price)}</td><td><button onClick={() => toggleSession(s.Session_ID)}>Remove</button></td></tr>))}
                            </tbody>
                        </table>
                    </div>
                    <div className="total" style={{padding: '0.5rem', textAlign: 'right'}}>Total: ${formatPrice(total)}</div>
                </div>
            </div>
        </div>
    );
}

export default App;