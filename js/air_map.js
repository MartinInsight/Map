/**
 * AirCongestionMap 클래스는 항공 교통 혼잡도 지도를 관리합니다.
 * 이 클래스는 Leaflet 라이브러리를 사용하여 지도를 초기화하고,
 * 항공 데이터를 로드하며, 혼잡도에 따라 마커를 렌더링하고,
 * 사용자 인터랙션을 위한 컨트롤(리셋 버튼, 필터, 범례, 마지막 업데이트 정보)을 추가합니다.
 */
class AirCongestionMap {
    /**
     * AirCongestionMap의 생성자.
     * @param {string} mapElementId - 지도가 렌더링될 HTML 요소의 ID.
     */
    constructor(mapElementId) {
        // Leaflet 지도 초기화: 주어진 ID를 가진 요소에 지도를 생성하고 초기 뷰와 줌 레벨을 설정합니다.
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        this.markers = []; // 지도에 표시될 마커들을 저장하는 배열
        this.currentData = null; // 현재 로드된 항공 데이터를 저장
        this.lastUpdated = null; // 데이터의 마지막 업데이트 시간을 저장
        this.filterControlInstance = null; // 혼잡도 필터 컨트롤 인스턴스 저장용
        this.lastUpdatedControl = null; // 마지막 업데이트 텍스트 컨트롤 인스턴스 저장용
        this.errorControl = null; // 오류 메시지 컨트롤 인스턴스 저장용
        this.legendControl = null; // 범례 컨트롤 인스턴스 저장용

        // OpenStreetMap 타일 레이어를 지도에 추가합니다.
        // `attribution`은 지도 데이터의 출처를 표시합니다.
        // `maxZoom`과 `minZoom`은 사용자가 확대/축소할 수 있는 범위를 제한합니다.
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 18, // 최대 줌 레벨
            minZoom: 2   // 최소 줌 레벨 설정 (고무줄 현상 방지)
        }).addTo(this.map);

        // 지도의 최대 범위를 설정하여 사용자가 특정 영역(미국 중심) 밖으로 크게 벗어나지 못하게 합니다.
        this.map.setMaxBounds([
            [-85, -180], // 남서쪽 경계 (남위 85도, 서경 180도)
            [85, 180]    // 북동쪽 경계 (북위 85도, 동경 180도)
        ]);

        // 줌 레벨 변경 시 발생하는 'zoomend' 이벤트 리스너를 추가합니다.
        // 이 로직은 `minZoom` 설정과 함께 지도의 "고무줄 현상"을 방지합니다.
        this.map.on('zoomend', () => {
            const currentZoom = this.map.getZoom();
            // 현재 줌이 최소 줌보다 작아지려고 하면 최소 줌으로 고정합니다.
            if (currentZoom < this.map.getMinZoom()) {
                this.map.setZoom(this.map.getMinZoom());
            }
        });

        // 데이터 로드와 관계없는 초기 컨트롤(예: 리셋 버튼)을 먼저 추가합니다.
        this.addControls();
        // 비동기적으로 항공 데이터를 로드하고, 로드 완료 후 마커와 추가 컨트롤을 렌더링합니다.
        this.loadData();
    }

    /**
     * `data/us-air.json` 파일에서 항공 데이터를 비동기적으로 로드합니다.
     * 데이터를 로드한 후 정규화하고, 마커를 렌더링하며,
     * 마지막 업데이트 텍스트와 필터 컨트롤을 추가/갱신합니다.
     */
    async loadData() {
        try {
            // 'us-air.json' 파일로부터 데이터를 가져옵니다.
            const response = await fetch('data/us-air.json');
            // HTTP 응답이 성공적이지 않으면 오류를 발생시킵니다.
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            // JSON 응답 본문을 파싱합니다.
            const rawData = await response.json();

            // 데이터를 정규화합니다:
            // - `lat`과 `lng` 필드가 없으면 `latitude_deg`와 `longitude_deg`를 사용합니다.
            // - `Airport` 필드가 없으면 `airport_code`를 사용하거나 'Unknown'으로 설정합니다.
            // - `lat`, `lng`, `Airport` 필드가 유효한 데이터만 필터링합니다.
            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.latitude_deg,
                lng: item.lng || item.longitude_deg,
                Airport: item.airport_code || 'Unknown'
            })).filter(item => item.lat && item.lng && item.Airport);

            // 로드된 데이터가 있을 경우, 첫 번째 항목의 `last_updated` 값을 가져와 저장합니다.
            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].last_updated;
            }

            // 마커를 지도에 렌더링합니다.
            this.renderMarkers();
            // 마지막 업데이트 텍스트 컨트롤을 추가/갱신합니다.
            this.addLastUpdatedText();
            // 혼잡도 필터 컨트롤을 추가/갱신합니다.
            this.addFilterControl();
            // 혼잡도 범례를 추가합니다.
            this.addAirLegend();
        } catch (error) {
            // 데이터 로드 중 오류가 발생하면 콘솔에 오류를 기록하고 사용자에게 메시지를 표시합니다.
            console.error("항공 데이터를 로드하지 못했습니다:", error);
            this.displayErrorMessage("항공 데이터를 로드하지 못했습니다. 잠시 후 다시 시도해주세요.");
        }
    }

    /**
     * TXO(Taxi-Out) 값에 따라 마커의 색상을 결정합니다.
     * @param {number} txo - 평균 TXO 값 (분).
     * @returns {string} - TXO 값에 해당하는 색상 코드 (hex).
     */
    getColorByTXO(txo) {
        if (txo == null) return '#cccccc'; // 데이터 없음

        // TXO 값 범위에 따라 색상을 반환합니다.
        if (txo >= 25) return '#d73027';  // 매우 혼잡 (빨강)
        if (txo >= 20) return '#fc8d59';  // 혼잡 (주황)
        if (txo >= 15) return '#fee08b';  // 보통 (노랑)
        if (txo >= 10) return '#d9ef8b';  // 원활 (연녹색)
        return '#1a9850';                 // 매우 원활 (초록)
    }

    /**
     * TXO(Taxi-Out) 값에 따라 마커의 반지름을 결정합니다.
     * @param {number} txo - 평균 TXO 값 (분).
     * @returns {number} - TXO 값에 해당하는 마커의 반지름 (픽셀).
     */
    getRadiusByTXO(txo) {
        if (txo == null) return 6; // 데이터 없음

        // TXO 값 범위에 따라 반지름을 반환합니다.
        if (txo >= 25) return 14;  // 매우 혼잡
        if (txo >= 20) return 12;  // 혼잡
        if (txo >= 15) return 10;  // 보통
        if (txo >= 10) return 8;   // 원활
        return 6;                  // 매우 원활
    }

    /**
     * 지도에 마커를 렌더링하거나 업데이트합니다.
     * @param {Array<Object>} [data=this.currentData] - 렌더링할 항공 데이터 배열. 기본값은 현재 로드된 데이터.
     */
    renderMarkers(data = this.currentData) {
        // 기존 마커들을 지도에서 제거하고 배열을 비웁니다.
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];

        // 제공된 데이터 배열의 각 항목에 대해 마커를 생성하고 지도에 추가합니다.
        data.forEach(item => {
            // 원형 마커를 생성하고 TXO 값에 따라 크기와 색상을 적용합니다.
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByTXO(item.average_txo),
                fillColor: this.getColorByTXO(item.average_txo),
                color: "#000",      // 테두리 색상
                weight: 1,          // 테두리 두께
                opacity: 1,         // 테두리 불투명도
                fillOpacity: 0.8    // 채우기 불투명도
            });

            // 마커에 마우스 오버/아웃 및 클릭 이벤트를 추가합니다.
            marker.on({
                // 마우스 오버 시 팝업을 표시합니다.
                mouseover: (e) => {
                    this.map.closePopup(); // 다른 팝업이 열려있다면 닫습니다.
                    const popup = L.popup()
                        .setLatLng(e.latlng) // 마우스 위치에 팝업을 설정합니다.
                        .setContent(this.createPopupContent(item)) // 데이터 기반으로 팝업 콘텐츠를 생성합니다.
                        .openOn(this.map); // 지도에 팝업을 엽니다.
                },
                // 마우스 아웃 시 팝업을 닫습니다.
                mouseout: () => {
                    this.map.closePopup();
                },
                // 클릭 시 팝업을 닫습니다. (선택적)
                click: () => {
                    this.map.closePopup();
                }
            });

            // 생성된 마커를 지도에 추가하고 마커 배열에 저장합니다.
            marker.addTo(this.map);
            this.markers.push(marker);
        });
    }

    /**
     * 마커 팝업에 표시될 HTML 콘텐츠를 생성합니다.
     * @param {Object} data - 팝업에 표시할 데이터 객체.
     * @returns {string} - HTML 문자열.
     */
    createPopupContent(data) {
        // 항공 데이터에 특화된 정보를 표시합니다.
        return `
            <div class="air-tooltip">
                <h4>${data.Airport || 'Unknown Airport'}</h4>
                <p><strong>평균 TXO:</strong> ${data.average_txo?.toFixed(2) || 'N/A'} 분</p>
                <p><strong>정시 운항:</strong> ${data.scheduled || 'N/A'}</p>
                <p><strong>출발 완료:</strong> ${data.departed || 'N/A'}</p>
                <p><strong>완료율:</strong> ${data.completion_factor || 'N/A'}%</p>
            </div>
        `;
    }

    /**
     * 지도에 일반 컨트롤(리셋 버튼)을 추가합니다.
     */
    addControls() {
        const controlContainer = L.control({ position: 'topright' }); // 컨트롤을 우상단에 배치

        controlContainer.onAdd = () => {
            // 컨트롤 컨테이너 DIV를 생성하고 CSS 클래스를 적용합니다.
            const div = L.DomUtil.create('div', 'map-control-container');
            div.innerHTML = `
                <button class="air-reset-btn reset-btn">뷰 초기화</button>
            `;

            // '뷰 초기화' 버튼에 클릭 이벤트 리스너를 추가합니다.
            div.querySelector('.air-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4); // 지도를 초기 뷰와 줌 레벨로 되돌립니다.
                this.renderMarkers(this.currentData); // 모든 데이터로 마커를 다시 렌더링합니다.
                // 필터 초기화: 필터 드롭다운을 '모든 공항'으로 초기화합니다.
                if (this.filterControlInstance) {
                    const congestionFilter = this.filterControlInstance._container.querySelector('.congestion-filter');
                    if (congestionFilter) congestionFilter.value = 'all';
                }
            });

            // Leaflet 컨트롤에 대한 이벤트 전파 방지 (클릭, 스크롤)
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        controlContainer.addTo(this.map); // 컨트롤을 지도에 추가합니다.
    }

    /**
     * 혼잡도 필터 컨트롤을 지도에 추가합니다.
     * 이 컨트롤은 사용자가 혼잡도 수준별로 공항을 필터링할 수 있도록 합니다.
     */
    addFilterControl() {
        // 기존 필터 컨트롤이 있다면 제거하여 중복을 방지합니다.
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' }); // 컨트롤을 우상단에 배치 (리셋 버튼 아래)

        control.onAdd = () => {
            // 필터 컨트롤 DIV를 생성하고 CSS 클래스를 적용합니다.
            const div = L.DomUtil.create('div', 'filter-control air-filter-control');

            // 혼잡도 필터 드롭다운을 생성합니다.
            div.innerHTML = `
                <select class="congestion-filter">
                    <option value="all">모든 공항</option>
                    <option value="very-high">매우 혼잡 (25+)</option>
                    <option value="high">혼잡 (20-24)</option>
                    <option value="medium">보통 (15-19)</option>
                    <option value="low">원활 (10-14)</option>
                    <option value="very-low">매우 원활 (<10)</option>
                </select>
            `;

            // 드롭다운 변경 시 필터링 로직을 실행합니다.
            div.querySelector('.congestion-filter').addEventListener('change', (e) => {
                this.applyFilter(e.target.value);
            });

            // Leaflet 컨트롤에 대한 이벤트 전파 방지 (클릭, 스크롤)
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            return div;
        };

        control.addTo(this.map); // 필터 컨트롤을 지도에 추가합니다.
        this.filterControlInstance = control; // 인스턴스를 저장하여 나중에 제거할 수 있도록 합니다.
    }

    /**
     * 선택된 필터 값에 따라 마커를 필터링하고 다시 렌더링합니다.
     * @param {string} filterValue - 선택된 필터 값 (예: 'all', 'very-high' 등).
     */
    applyFilter(filterValue) {
        if (!this.currentData) return; // 데이터가 없으면 아무것도 하지 않습니다.

        let filteredData = this.currentData;
        if (filterValue !== 'all') {
            filteredData = this.currentData.filter(item => {
                const txo = item.average_txo;
                if (txo == null) return false; // TXO 데이터가 없으면 필터링에서 제외

                switch (filterValue) {
                    case 'very-high': return txo >= 25;
                    case 'high': return txo >= 20 && txo < 25;
                    case 'medium': return txo >= 15 && txo < 20;
                    case 'low': return txo >= 10 && txo < 15;
                    case 'very-low': return txo < 10;
                    default: return true; // 알 수 없는 필터 값은 모든 데이터를 반환
                }
            });
        }
        this.renderMarkers(filteredData); // 필터링된 데이터로 마커를 다시 렌더링합니다.
    }

    /**
     * 지도에 마지막 데이터 업데이트 시간을 표시하는 컨트롤을 추가합니다.
     */
    addLastUpdatedText() {
        // 기존 컨트롤이 있다면 제거하여 중복을 방지합니다.
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        // `lastUpdated` 데이터가 있을 경우에만 컨트롤을 추가합니다.
        if (this.lastUpdated) {
            const infoControl = L.control({ position: 'bottomleft' }); // 좌하단에 배치

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                // ISO 날짜 문자열을 Date 객체로 변환하고 로케일에 맞춰 포맷합니다.
                const date = new Date(this.lastUpdated);
                // 한국어 날짜 형식으로 변환 (예: 2023년 10월 27일 오후 3:30)
                const formattedDate = date.toLocaleString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: false // 24시간 형식
                });
                div.innerHTML = `<strong>최종 업데이트:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map); // 컨트롤을 지도에 추가합니다.
            this.lastUpdatedControl = infoControl; // 인스턴스를 저장합니다.
        }
    }

    /**
     * 항공 혼잡도 범례를 지도에 추가합니다.
     */
    addAirLegend() {
        // 기존 범례가 있다면 제거하여 중복을 방지합니다.
        if (this.legendControl) {
            this.map.removeControl(this.legendControl);
        }

        const legend = L.control({ position: 'bottomright' }); // 우하단에 배치

        legend.onAdd = () => {
            const div = L.DomUtil.create('div', 'air-legend'); // 범례 DIV 생성
            // TXO 값에 따른 혼잡도 등급과 해당하는 색상, 라벨을 정의합니다.
            const grades = [0, 10, 15, 20, 25]; // TXO 값 기준점
            const labels = ['매우 원활', '원활', '보통', '혼잡', '매우 혼잡'];
            const colors = ['#1a9850', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027'];

            div.innerHTML += '<div class="air-legend-title">혼잡도 (평균 Taxi-Out 시간)</div>';

            // 각 등급에 대해 색상 블록과 라벨을 생성합니다.
            for (let i = 0; i < grades.length; i++) {
                div.innerHTML +=
                    '<div class="air-legend-item">' +
                    '<span class="air-legend-color" style="background:' + colors[i] + '"></span> ' +
                    labels[i] + (grades[i + 1] ? ' (' + grades[i] + '-' + (grades[i+1]-1) + '분)' : ' (' + grades[i] + '분 이상)') +
                    '</div>';
            }
            return div;
        };

        legend.addTo(this.map); // 범례를 지도에 추가합니다.
        this.legendControl = legend; // 인스턴스를 저장합니다.
    }


    /**
     * 지도에 오류 메시지를 표시하는 컨트롤을 추가합니다.
     * @param {string} message - 표시할 오류 메시지.
     */
    displayErrorMessage(message) {
        // 기존 오류 메시지 컨트롤이 있다면 제거합니다.
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' }); // 오류 메시지를 좌상단에 배치
        errorControl.onAdd = function() {
            // 오류 메시지 DIV를 생성하고 CSS 클래스를 적용합니다.
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message; // 메시지를 DIV에 설정합니다.
            return div;
        };
        errorControl.addTo(this.map); // 컨트롤을 지도에 추가합니다.
        this.errorControl = errorControl; // 인스턴스를 저장합니다.
    }
}

// 전역 스코프에 클래스를 노출하여 `index.html`에서 접근할 수 있도록 합니다.
window.AirCongestionMap = AirCongestionMap;
