import dynamic from "next/dynamic";

const MapOrdersMap = dynamic(() => import("./MapOrdersMap.client"), {
  ssr: false,
  loading: () => null,
});

export default MapOrdersMap;
