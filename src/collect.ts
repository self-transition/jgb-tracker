import throttle from 'lodash/throttle';
import { IConfigComponentItem, IConfigMethod, IConfigPageItem } from './config';
import { Context } from './expression/context';
import { runInConext } from './expression/index';
import { getCurrentPage, hasCode, safeGet } from './utils';

// tslint:disable-next-line: ban-types
export type IMapFunction = Map<string, Function>;

export interface ICollectData {
  eventName: string;
  data: any;
  [key: string]: any;
}

export type INotify = (collect: ICollectData) => any;

/** 私有page options，仅供jgb-tracker使用  */
export const privateOptions: string = Symbol('options') as any;
/** 私有app options，仅供jgb-tracker使用  */
export const privateAppOptions: string = Symbol('appOptions') as any;
/**
 * 处理 getData
 */
export type IDataProcessor = (
  /**
   * 获取数据的路径
   * @example '$APP.data'
   */
  path: string,
  /**
   * 事件method的参数
   */
  args: any[],
  /**
   * 当前作用域
   * @example App、Page、Component
   */
  ctx: any
) => [boolean, any] | undefined;

const getDataProcessors = [] as IDataProcessor[];
const notifyPool = [] as INotify[];

export class Collector {
  private collect = new Map<string, IMapFunction>();
  /** tracker触发频率 */
  static MS = 50;
  getData = getData;

  /**
   * 取消注册
   */
  unregister(path: string) {
    this.collect.delete(path);
  }

  registerMethodWithMap(map: IMapFunction, m: IConfigMethod) {
    const { method, data, eventName } = m;
    if (map.has(method)) {
      return;
    }
    const fn = throttle(
      (ctx: any, ...args: any[]) => {
        const reportData: any = Object.create(null);
        const keys = Object.keys(data);
        for (const key of keys) {
          const valuePath = data[key];
          reportData[key] = this.getData(valuePath, args, ctx);
        }

        const collectData = {
          ...m,
          data: reportData
        };
        this.notify(collectData);
      },
      Collector.MS,
      {
        trailing: false
      }
    );
    // 默认 50ms 触发一次
    map.set(method, fn);
  }
  /**
   * 注册方法
   * @param path
   * @param method
   * @param data
   */
  registerMethod(path: string, m: IConfigMethod) {
    let map = this.collect.get(path);
    if (!map) {
      map = new Map();
      this.collect.set(path, map);
    }
    this.registerMethodWithMap(map, m);
  }

  /**
   * 获取注册的方法
   * @param path
   * @param method
   */
  getMethod(path: string, method: string) {
    const map = this.collect.get(path);

    if (!map) {
      return;
    }
    return map.get(method);
  }

  /**
   * 触发方法
   * @param path
   * @param method
   * @param args
   */
  invokeMethod(path: string, method: string, args: any[]) {
    const fn = this.getMethod(path, method);
    if (!fn) {
      return;
    }
    // console.log('fn', fn);
    fn.apply(null, args);
  }

  notify(collectData: ICollectData) {
    for (const notify of notifyPool) {
      notify(collectData);
    }
  }
}

export const collector = new Collector();

/**
 * 增加触发事件通知
 * @example
 * addNotify((data) => {
 *   sendEvent(data)
 * })
 */
export function addNotify(n: INotify) {
  notifyPool.push(n);
}

export function registerCollect(
  config: IConfigPageItem | IConfigComponentItem
) {
  const hash = hasCode(JSON.stringify(config));
  return { hash, collector };
}

const globalContextFns: any[] = [];

/**
 * 添加全局预设值
 */
export function addGlobalContext(fn: () => { [key: string]: any }) {
  if (typeof fn !== 'function') {
    return;
  }
  globalContextFns.push(fn);
}

/**
 * 获取对应的数据
 *  $APP.a => getApp().a
 *  $DATASET.b => e.currentTarget.dataset.b
 *  $DATA.c => this.data.c
 * @param args 方法的参数
 * @param ctx page or component 实例
 * @param path 获取数据路径
 */
export function getData(path: string, args: any[], ctx: any = {}) {
  const event = args[0];
  const curPage = getCurrentPage() as any;
  const app = getApp();
  const globalContext = globalContextFns.reduce(
    (obj, fn) => Object.assign(obj, fn()),
    {}
  );
  const context = new Context(globalContext);
  context.addContext({
    // 获取app实例的数据
    $APP: app,
    // 获取wxml中data-*系列属性的值
    $DATASET: safeGet(event, 'currentTarget.dataset'),
    // 事件
    $EVENT: event,
    // page options
    $OPTIONS:
      (ctx && ctx[privateOptions]) || (curPage && curPage[privateOptions]),
    // app onLaunch options
    $APPOPTIONS: app && app[privateAppOptions],
    // 获取data上数据
    $DATA: ctx && ctx.data
  });

  try {
    const result = runInConext(path, context);
    return result;
  } catch {
    // 默认直接返回改值
    return path;
  }
}
