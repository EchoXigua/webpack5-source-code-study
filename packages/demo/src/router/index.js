import VueRouter from "vue-router";
import Vue from "vue";

Vue.use(VueRouter);

const routes = [
  {
    name: "home",
    path: "/",
    component: () => import("../views/Home.vue"),
  },
  {
    name: "about",
    path: "/about",
    component: () => import("../views/About.vue"),
  },
];

const router = new VueRouter({
  mode: "history",
  routes,
  scrollBehavior: () => ({ y: 0 }),
});

export default router;
